# DevCockpit

**The cockpit for your dev day.** One desktop app that shows everything you're working on locally: every repo, every Claude Code session, every open pull request. Resume any session in the built-in terminal with one click.

> Status: early development (Phase 1). Not released yet.

## What it does

- **Today**: a quick overview of where to start. It picks the session you were last on, lists repos with uncommitted or unpushed work, PRs waiting for your review, and open to-dos.
- **Repos**: every git repo in your project folders, with branch, changes, ahead/behind, recent commits, to-dos (from `TODO.md`, `actions.md` and `ROADMAP.md`), and the sessions and PRs that belong to it.
- **Sessions**: all your Claude Code sessions, grouped by repo and searchable by full text. Read any transcript, or **Resume** it in the right folder.
- **Pull requests**: yours, the ones waiting for your review, and recently merged ones, across every repo. Uses your existing `gh` login.
- **Built-in terminal**: real Claude Code and shell tabs inside the app (`Ctrl+\``).

## Roadmap

- **Phase 2:** push-to-talk voice input that works in any app (local Whisper, no audio leaves your machine); a "what can my machine run?" check that picks and installs the right local model through Ollama; routine tasks such as summaries and overviews running on that local model so they don't use Claude tokens.
- **Phase 3:** an email assistant (sorts email, finds job invites, writes drafts and never sends them), plus schedules and routines.
- **Phase 4:** signed installers for Windows, macOS and Linux, and a demo mode.

## Security

DevCockpit embeds a real terminal, so security comes first. It never opens a network port, since the UI talks to the backend over Electron IPC. The UI is sandboxed with no Node access, and IPC is limited to a small set of validated calls. A strict Content Security Policy blocks remote code. Transcripts are rendered as plain text, never HTML. There's no telemetry, and no tokens are stored: GitHub access goes through your own `gh` login. See [SECURITY.md](SECURITY.md).

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
