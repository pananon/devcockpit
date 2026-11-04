# Contributing to DevCockpit

Thanks for helping. DevCockpit runs a real terminal and reads people's Claude Code transcripts, so the bar for security is higher than for a typical dashboard. This guide explains how the code is laid out and the few rules every change has to follow.

## Getting started

Requires Node 22+ and git. The [GitHub CLI](https://cli.github.com), [Claude Code](https://claude.com/claude-code) and [Ollama](https://ollama.com) are optional; the app works without them.

```bash
git clone https://github.com/pananon/devcockpit.git
cd devcockpit
npm ci
npm run dev        # hot reload
npm run demo       # made-up data, safe for screenshots
npm run typecheck  # must pass before a PR
npm run build
```

Use `npm run demo` whenever you take a screenshot or record a video for an issue or PR. It shows fictional repos and sessions, never your own.

## How the code is laid out

| Folder | What lives there |
|---|---|
| `src/main/` | The Electron main process: everything that touches the disk, git, `gh`, Ollama, terminals. One file per area (`sessions.ts`, `repos.ts`, `todos.ts`, `pty.ts`…). `index.ts` registers the IPC handlers and validates every argument. `demo.ts` is the fake backend for demo mode. |
| `src/preload/` | The only bridge between UI and system: one typed method per IPC channel. |
| `src/renderer/src/` | The React UI. `views/` holds one file per screen, `components/` the shared pieces, `hud.css` the HUD look. |
| `src/shared/types.ts` | Types shared by all three, including `CockpitApi`, the full list of what the UI can ask for. |

Adding a feature that needs the system usually means four steps:
1. Add a method to `CockpitApi` in `types.ts`.
2. Expose it in the preload.
3. Handle the channel in `index.ts`, validating its arguments.
4. Add a fake answer in `demo.ts`. Demo mode refuses any channel without one, so the typecheck and the demo will tell you if you forgot.

## Security rules

These are non-negotiable. A PR that breaks one won't be merged, however useful the feature.

- **No shell strings.** Run programs with `execFile` / `spawn` and an argument array. If text from a user, a transcript or a model has to reach a command, pass it in an environment variable (see `pty.ts` and `routineRunner.ts`).
- **Validate in the main process.** The UI is untrusted. Every IPC handler checks argument types and sizes, and paths come from DevCockpit's own data (the repo list, the session index), never straight from the UI.
- **Never render untrusted text as HTML.** Transcripts, commit messages, PR titles and model output are rendered as React text. No `dangerouslySetInnerHTML`.
- **No network servers, no remote code.** The app opens no port, loads no remote scripts, and only talks to Ollama on loopback.
- **No stored credentials.** GitHub goes through the user's own `gh` login. Features that would need passwords or tokens (email, cloud APIs) are out of scope.
- **Write only when asked.** DevCockpit changes files only on an explicit user action (adding or ticking a todo, deleting a session to the Recycle Bin, saving or installing a skill after a confirmation dialog). Anything new in that list needs discussion first.
- **Few dependencies.** The app ships with one runtime dependency (`node-pty`). Adding one needs a strong reason in the PR. Pin exact versions.

See [SECURITY.md](SECURITY.md) for the full threat model. To report a vulnerability, use private reporting, not an issue.

## Style

- TypeScript strict, React function components, no UI framework.
- Match the surrounding code: short comments that explain *why*, plain names, small files.
- UI text is plain English: short sentences, no jargon, say what a button does ("Move to Recycle Bin", not "Purge").
- Features must work without a local model, and with the local AI switched off.

## Pull requests

1. Fork, then branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Keep a PR to one change, with a description of what changed and how you tested it.
3. `npm run typecheck` and `npm run build` must pass. CI runs them on Windows, macOS and Linux, plus a dependency audit.
4. For UI changes, add a demo-mode screenshot.

By contributing you agree that your work is released under the [MIT licence](LICENSE), and to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
