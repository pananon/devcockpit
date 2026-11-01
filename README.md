# DevCockpit

**The cockpit for your dev day.** One desktop app that shows everything you're working on locally: every repo, every Claude Code session, every open pull request. Resume any session in the built-in terminal with one click.

> Status: early development (Phase 4 next: installers and launch). Not released yet.

## What it does

- **Today**: a quick overview of where to start. Your brief lists three priorities, each linked to the repo, PR or session it comes from. The facts are taken straight from git, your sessions and GitHub, and the local model only ranks them, so nothing is made up. It works without a model too.
- **Repos**: every git repo in your project folders, with branch, changes, ahead/behind, recent commits, to-dos (from `TODO.md`, `actions.md` and `ROADMAP.md`), and the sessions and PRs that belong to it.
- **Sessions**: all your Claude Code sessions, grouped by repo and searchable by full text. Read any transcript, or **Resume** it in the right folder.
- **Pull requests**: yours, the ones waiting for your review, and recently merged ones, across every repo. Uses your existing `gh` login.
- **Built-in terminal**: real Claude Code and shell tabs inside the app (`Ctrl+\``).
- **Voice**: press `Ctrl+Shift+Space` in any app and speak. It stops when you pause and pastes the text where your cursor is. Your repo names are recognised even when Whisper mishears them. Inside DevCockpit it goes into the focused box or the active terminal. Whisper runs locally, on your GPU when one is available.
- **Routines**: scheduled jobs (daily brief, questions to the local model, read-only Claude Code tasks), with notifications and an optional tray mode so they run with the window closed.
- **Local AI**: one click checks your CPU, RAM and GPU and recommends the best model your machine can run through [Ollama](https://ollama.com). Use it for a morning brief, session summaries and quick questions, without spending Claude tokens.

## Roadmap

- **Phase 2 (done):** voice with hands-free auto-stop and hold-to-talk, automatic correction of your repo names, a fact-grounded daily brief, and formatted transcripts.
- **Phase 3 (done):** routines. (An email assistant was built and then removed on purpose: no mailbox access means no stored credentials and a smaller attack surface.)
- **Phase 4:** signed installers for Windows, macOS and Linux, and a demo mode.

## Security

DevCockpit embeds a real terminal, so security comes first. It never opens a network port, since the UI talks to the backend over Electron IPC. The UI is sandboxed with no Node access, and IPC is limited to a small set of validated calls. A strict Content Security Policy blocks remote code. Transcripts are rendered as plain text, never HTML. There's no telemetry and no stored credentials: GitHub access goes through your own `gh` login. See [SECURITY.md](SECURITY.md).

## Development

Requires Node 22+, git, and optionally the [GitHub CLI](https://cli.github.com) and [Claude Code](https://claude.com/claude-code).

```bash
npm ci
npm run dev        # run with hot reload
npm run typecheck
npm run build
```

## License

[MIT](LICENSE). DevCockpit is an independent project and is not affiliated with or endorsed by Anthropic.
