import { describe, it, expect } from 'vitest'
import { createEventLog } from '../src/events'

describe('EventLog.subscribe', () => {
  it('delivers newly added events to subscribers in order', () => {
    const log = createEventLog()
    const seen: number[] = []
    log.subscribe((e) => seen.push(e.id))
    log.add('a', {}, 'unknown')
    log.add('b', {}, 'unknown')
    expect(seen).toEqual([1, 2])
  })

  it('does not replay past events to a late subscriber', () => {
    const log = createEventLog()
    log.add('a', {}, 'unknown')
    const seen: number[] = []
    log.subscribe((e) => seen.push(e.id))
    log.add('b', {}, 'unknown')
    expect(seen).toEqual([2])
  })

  it('stops delivering after unsubscribe', () => {
    const log = createEventLog()
    const seen: number[] = []
    const off = log.subscribe((e) => seen.push(e.id))
    log.add('a', {}, 'unknown')
    off()
    log.add('b', {}, 'unknown')
    expect(seen).toEqual([1])
  })

  it('isolates a throwing subscriber from add() and other subscribers', () => {
    const log = createEventLog()
    const seen: number[] = []
    log.subscribe(() => { throw new Error('boom') })
    log.subscribe((e) => seen.push(e.id))
    expect(() => log.add('a', {}, 'unknown')).not.toThrow()
    expect(seen).toEqual([1])
  })
})
