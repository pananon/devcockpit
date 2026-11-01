# DevCockpit

**The cockpit for your dev day.** One desktop app that shows everything you're working on locally: every repo, every Claude Code session, every open pull request. Resume any session in the built-in terminal with one click.

> Status: early development (Phase 4 in progress: installers and launch). Not released yet.

## What it does

- **Today (mission control)**: where to start. Three priorities, each linked to the repo, PR or session it comes from, with one click to engage. The facts are taken straight from git, your sessions and GitHub, and the local model only ranks them, so nothing is made up. It works without a model too. Also on the page: a session timeline, a repo matrix, your PRs and your next routine.
- **Workspace**: every git repo in your project folders as one tree. Changes, sessions, pull requests and to-dos (from `TODO.md`, `actions.md` and `ROADMAP.md`) sit under the repo they belong to, next to an activity feed across all repos.
- **Command palette** (`Ctrl+K`): jump to any repo, session or PR, run a repo's actions, or ask the local model a question. Press `g` then a letter to switch screens.
- **Focus mode** (`Ctrl+.`): one repo and one next step, with everything else queued behind it. Press `1`, `2` or `3` to switch.
- **Flow board**: your work as a pipeline: In progress, Ready to push, In review, Shipped. Work that has gone stale is flagged.
- **Sessions**: all your Claude Code sessions, grouped by repo and searchable by full text. Read any transcript, or **Resume** it in the right folder.
- **Pull requests**: yours, the ones waiting for your review, and recently merged ones, across every repo. Uses your existing `gh` login.
- **Built-in terminal**: real Claude Code and shell tabs inside the app (`Ctrl+\``).
- **Routines**: scheduled jobs (daily brief, questions to the local model, read-only Claude Code tasks), with notifications and an optional tray mode so they run with the window closed.
- **Local AI**: one click checks your CPU, RAM and GPU and recommends the best model your machine can run through [Ollama](https://ollama.com). Use it for briefs, session summaries and questions about your work, without spending Claude tokens.

## Roadmap

- **Phase 2 (done):** local AI, a fact-grounded daily brief, and formatted transcripts.
- **Phase 3 (done):** routines. Two features were built and then left out of the main app on purpose: an email assistant, because no mailbox access means no stored credentials, and voice input, which wasn't polished enough to ship. Voice lives on the `feature/voice` branch.
- **Phase 4:** installers for Windows, macOS and Linux, a demo mode, and security CI.

## Security

DevCockpit embeds a real terminal, so security comes first:

- It never opens a network port. The UI talks to the backend over Electron IPC.
- The UI is sandboxed with no Node access, and IPC is limited to a small set of validated calls.
- A strict Content Security Policy blocks remote code.
- Transcripts are never rendered as HTML.
- No browser permissions are granted.
- There's no telemetry and no stored credentials. GitHub access goes through your own `gh` login.

See [SECURITY.md](SECURITY.md).

## Development

Requires Node 22+, git, and optionally the [GitHub CLI](https://cli.github.com) and [Claude Code](https://claude.com/claude-code).

```bash
npm ci
npm run dev        # run with hot reload
npm run typecheck
npm run build
npm run demo       # run with made-up data
```

Demo mode fills every screen with fictional repos, sessions and PRs, so screenshots and screen recordings never show your real work. It reads nothing from your disk, runs no commands, and keeps its own settings. The terminal replays a sample session and doesn't run anything you type. The installed app takes the same `--demo` flag.

## License

[MIT](LICENSE). DevCockpit is an independent project and is not affiliated with or endorsed by Anthropic.
