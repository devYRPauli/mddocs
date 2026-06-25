import type * as Y from 'yjs'

// A document event an agent can poll for. Both human (browser) edits and agent
// mutations land on the same live Y.Doc, so both surface here uniformly. Ids are
// monotonic per serve session; poll with `?after=<id>` to receive only newer
// events, then `ack` once handled.
export interface DocEvent {
  id: number
  /** e.g. agent.presence, agent.disconnected, mark.added, mark.updated, mark.removed, document.changed. */
  type: string
  data: Record<string, unknown>
  /** Cause: "ai:<model>", "human:<name>", or "unknown". */
  actor: string
  createdAt: string
  ackedAt?: string
  ackedBy?: string
}

export interface EventLog {
  add(type: string, data: Record<string, unknown>, actor: string): DocEvent
  /** Events with id strictly greater than `after`, up to `limit`. */
  list(after: number, limit: number): DocEvent[]
  /** Mark every unacked event with id <= upToId as acknowledged; returns the count. */
  ack(upToId: number, by: string): number
  size(): number
  /** Receive every event added after this call. Returns an unsubscribe fn. */
  subscribe(fn: (e: DocEvent) => void): () => void
}

// Keep the in-memory log bounded so a long-lived session does not grow without
// limit. Agents poll-and-ack, so old events are not needed once consumed.
const MAX_EVENTS = 2000

export function createEventLog(): EventLog {
  let nextId = 1
  const events: DocEvent[] = []
  const subscribers = new Set<(e: DocEvent) => void>()
  return {
    add(type, data, actor) {
      const event: DocEvent = { id: nextId++, type, data, actor, createdAt: new Date().toISOString() }
      events.push(event)
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
      for (const fn of subscribers) {
        // A dead/throwing subscriber must not break add() or sibling subscribers.
        try { fn(event) } catch { /* ignore */ }
      }
      return event
    },
    list(after, limit) {
      const out: DocEvent[] = []
      for (const e of events) {
        if (e.id > after) {
          out.push(e)
          if (out.length >= limit) break
        }
      }
      return out
    },
    ack(upToId, by) {
      const at = new Date().toISOString()
      let acked = 0
      for (const e of events) {
        if (e.id <= upToId && !e.ackedAt) {
          e.ackedAt = at
          e.ackedBy = by
          acked++
        }
      }
      return acked
    },
    size() {
      return events.length
    },
    subscribe(fn) {
      subscribers.add(fn)
      return () => { subscribers.delete(fn) }
    },
  }
}

export interface PresenceEntry {
  id: string
  name?: string
  color?: string
  avatar?: string
  status: string
  details: string
  at: string
}

export interface PresenceRegistry {
  upsert(entry: PresenceEntry): PresenceEntry
  remove(id: string): boolean
  list(): PresenceEntry[]
}

// Bound the registry so a misbehaving client cannot grow it without limit. With
// ids bound to the issuing token (see share.ts) this is already naturally small;
// the cap is defense in depth - on overflow the oldest entry is evicted.
const MAX_PRESENCE = 64

export function createPresenceRegistry(): PresenceRegistry {
  const byId = new Map<string, PresenceEntry>()
  return {
    upsert(entry) {
      if (!byId.has(entry.id) && byId.size >= MAX_PRESENCE) {
        const oldest = byId.keys().next().value
        if (oldest !== undefined) byId.delete(oldest)
      }
      byId.set(entry.id, entry)
      return entry
    },
    remove(id) {
      return byId.delete(id)
    },
    list() {
      return [...byId.values()]
    },
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

// Observe the shared live Y.Doc and project mark + prose changes into the event
// log. Mark writes (comments, suggestions, accept/reject, replies, provenance)
// come from both humans editing in the browser and agents mutating via the HTTP
// API - both mutate the same `marks` Y.Map, so one observer captures all, with
// the actor read from each mark's `by` field. Prose edits fire densely while a
// human types, so document.changed is coalesced into one event per quiet
// interval. Returns a disposer.
export function observeDocForEvents(
  doc: Y.Doc,
  log: EventLog,
  opts: { debounceMs?: number } = {},
): () => void {
  const marks = doc.getMap('marks')
  const fragment = doc.getXmlFragment('prosemirror')

  const onMarks = (event: Y.YMapEvent<unknown>): void => {
    for (const [key, change] of event.keys) {
      if (change.action === 'delete') {
        log.add('mark.removed', { markId: key }, 'unknown')
        continue
      }
      const mark = marks.get(key) as Record<string, unknown> | undefined
      const by = readString(mark?.by) ?? 'unknown'
      const kind = readString(mark?.kind)
      const data = (mark?.data ?? {}) as Record<string, unknown>
      const status = readString(data.status) ?? readString(mark?.status)
      log.add(
        change.action === 'add' ? 'mark.added' : 'mark.updated',
        { markId: key, ...(kind ? { kind } : {}), by, ...(status ? { status } : {}) },
        by,
      )
    }
  }
  marks.observe(onMarks)

  const debounceMs = opts.debounceMs ?? 150
  let timer: ReturnType<typeof setTimeout> | undefined
  const onFragment = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      log.add('document.changed', { chars: fragment.toString().length }, 'unknown')
    }, debounceMs)
  }
  fragment.observeDeep(onFragment)

  return () => {
    marks.unobserve(onMarks)
    fragment.unobserveDeep(onFragment)
    if (timer) clearTimeout(timer)
  }
}
