# VHS tape for the mddocs README screencast.
# Render with:  vhs examples/demo.tape   (produces examples/demo.gif)
# Requires the built CLI at publish/cli.mjs (npm run build && scripts/build-npm.mjs).

Output examples/demo.gif

Set Shell bash
Set FontSize 15
Set Width 1240
Set Height 760
Set Padding 24
Set TypingSpeed 45ms
Set Theme "Catppuccin Mocha"

# --- hidden setup: fresh repo, live serve, captured agent token ---
Hide
Type 'export REPO="/Users/yashrajpandey/Open-Source Projects/mddocs"'
Enter
Type 'mddocs() { node "$REPO/publish/bin.mjs" "$@"; }'
Enter
Type 'cd "$(mktemp -d)"'
Enter
Type 'git init -q && git config user.email sam@demo.dev && git config user.name "Sam"'
Enter
Type "printf '# Q3 launch notes\n\nOur new editor is the fastest on the market. We shipped it in record time.\nThe onbaording flow needs another pass before launch.\n' > notes.md"
Enter
Type 'git add -A && git commit -qm "draft launch notes" >/dev/null'
Enter
Type 'mddocs init >/dev/null 2>&1'
Enter
Type 'mddocs serve notes.md --port 7470 --agent reviewer >serve.log 2>&1 &'
Enter
Type 'until curl -sf -o /dev/null http://127.0.0.1:7470/; do sleep 0.2; done'
Enter
Type 'export AGENT_BASE=$(grep -oE "http://[^ ]+/api/agent/[^ ]+" serve.log | head -1)'
Enter
Type 'export TOKEN=$(grep "reviewer:" serve.log | grep -oE "[a-f0-9-]{36}")'
Enter
Type 'clear'
Enter
Show

# --- visible screencast ---
Sleep 600ms
Type "# mddocs: a human and an AI agent edit the same Markdown file, live."
Enter
Sleep 1s
Type "cat notes.md"
Enter
Sleep 2500ms

Type "# The AI reviewer reads the doc and leaves feedback over the agent API:"
Enter
Sleep 800ms
Type 'node "$REPO/examples/demo-review.mjs" "$AGENT_BASE" "$TOKEN"'
Enter
Sleep 4s

Type "# The human reviews what the agent left - from the terminal:"
Enter
Sleep 800ms
Type "mddocs comment ls notes.md"
Enter
Sleep 3500ms

Type "# Accept the agent's typo fix:"
Enter
Sleep 800ms
Type 'mddocs accept "$(cat .last-suggestion)" --file notes.md'
Enter
Sleep 2s
Type "head -4 notes.md"
Enter
Sleep 3s

Type "# Authorship is recorded in the file; history is plain git:"
Enter
Sleep 800ms
Type 'grep -m1 "ai:claude-opus-4-8" notes.md'
Enter
Sleep 2s
Type "git log --oneline"
Enter
Sleep 3500ms

Hide
Type 'kill %1 2>/dev/null'
Enter
