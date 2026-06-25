# mddocs examples

## `agent-reviewer.mjs` - a human + agent live demo

A minimal "reviewer agent" that uses the M3 agent HTTP API to comment on a live
document. Its comments and suggestion appear in every connected human editor in
real time and are saved to the file + git, attributed to `ai:<model>`.

### Run it

1. Start a live session and open the editor (you are the human):

   ```bash
   # in a git repo containing your markdown
   npx tsx packages/mddocs-cli/src/bin.ts serve notes.md
   ```

   `serve` prints an **agent API** block - copy the **base URL** and **token**.

2. In another terminal, run the agent against that base URL + token:

   ```bash
   node examples/agent-reviewer.mjs http://127.0.0.1:<port>/api/agent/notes.md <agent-token>
   ```

3. Watch the editor: the agent's comments pop in one at a time on the sentences
   it reviewed, and a suggestion appears on the first one. Accept/reject the
   suggestion from the editor or the CLI:

   ```bash
   npx tsx packages/mddocs-cli/src/bin.ts accept <suggestion-id> --file notes.md
   ```

Everything the agent did is now in `notes.md` (in the `<!-- PROOF -->` footer)
and committed to git - fully local, no hosted service.

## `agent-watcher.mjs` - react to changes in real time (SSE)

The push counterpart to the reviewer. Instead of polling, it subscribes to the
document's event stream over Server-Sent Events and prints every change - human
edits in the browser AND other agents' mutations - the instant it happens.

### Run it

1. Start a live session as above (`serve` prints the **agent API** base + token).

2. In another terminal, watch the stream:

   ```bash
   node examples/agent-watcher.mjs http://127.0.0.1:<port>/api/agent/notes.md <agent-token>
   ```

3. Edit the doc in the browser, or run `agent-reviewer.mjs` in a third terminal.
   Each change prints live, e.g.:

   ```
   #2  mark.added       by ai:claude-opus-4-8   comment m17824...
   #3  document.changed by unknown              169 chars
   ```

Pass `--after <id>` to replay events newer than `<id>` from the in-memory backlog
before streaming live (`--after 0` replays everything still buffered). The watcher
reconnects automatically if the connection drops, resuming from the last event id
it saw (via the standard `Last-Event-ID` header) so no buffered event is missed.
