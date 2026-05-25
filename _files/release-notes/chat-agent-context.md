# Chat agent context (Skippr IDE)

## Implementation

- **SkipprCliAgent**: thread id from streamed JSONL (`thread_assigned`, `ChatSummary`); persisted per workspace/config/pipeline/mode under `.skippr/ide/chat-thread.json`; `--thread` on subsequent messages; `await_user` wired to session input UI with resume.
- **skippr-workbench**: SQL “Ask data question” stores thread id in `globalState` and resumes with `--thread`.

Requires a `skipprd` build that includes the companion `skipprd` / `react` chat-agent-context changes (headless prompt, thread id in `ChatSummary`, IDE-interactive ask).

## Human review

1. `npm run apply:overlay` then `npm run dev` from `skippr-ide/vscode`; launch Extension Development Host.
2. Enable `skippr.dev.useLocalSkipprd`; open `sdgsdgsdsd` with root `skippr.yml`.
3. Open Skippr Agent (`agent-host-skippr`), mode **ask**, pipeline **bike_hire**.
4. Run verification steps T1–T7 in `skipprd/_files/release-notes/chat-agent-context.md`.
