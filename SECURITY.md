# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the Security tab). You'll get a reply within 72 hours.

## Design principles

DevCockpit runs a real terminal and reads your local transcripts, so anything that can control its UI can run code on your machine. The design assumes that and minimises the attack surface:

| Risk | Mitigation |
|---|---|
| Remote access | No network server or open port. The UI and backend talk only over Electron IPC. |
| Malicious content in transcripts, commit messages or PR titles (XSS) | All of it is rendered as React text nodes. No `dangerouslySetInnerHTML` and no HTML rendering of untrusted data. |
| Remote code in the UI | Strict CSP (`script-src 'self'`), all assets bundled, no CDN scripts. |
| A compromised renderer reaching Node | `sandbox`, `contextIsolation` and no `nodeIntegration`. The preload exposes only typed calls. Every IPC call checks that it came from our own page and validates its arguments. |
| Navigation and popups | In-app navigation, new windows and `<webview>` are all blocked. External links open in the system browser, and only over `https://`. |
| Command injection | `git` and `gh` run through `execFile` without a shell. Session IDs are checked as UUIDs before reaching a command line. |
| Credential theft | DevCockpit stores no credentials of any kind. GitHub access goes through your own `gh` login, and the app has no email or account access. No telemetry. |
| Browser permissions | All denied: camera, microphone, location, notifications and clipboard. |
| Local AI | Ollama is only contacted on loopback (127.0.0.1/localhost), even if `OLLAMA_HOST` points elsewhere. Prompts wrap your data in `<data>` tags and tell the model to ignore instructions inside them, and model output is rendered as React elements, never HTML. Ollama is only installed when you click Install. The official installer then runs visibly in a terminal tab (winget on Windows, which checks the installer's SHA-256). |
| Routines | Claude Code routines run headless with read-only tools (`Read`, `Grep`, `Glob`): no edits and no shell. Your own Claude Code permission rules still apply. On Windows the prompt is passed in an environment variable, so it's never parsed by a shell. Routines that use Claude tokens are labelled as such. |
| Background mode | Off by default. When you turn it on, DevCockpit adds a tray icon and a login item, and both are removed when you turn it off. Nothing else is installed (no services or scheduled tasks). |
| Files DevCockpit writes | Only two kinds, both on your request. Adding or ticking a todo edits `TODO.md`, `ROADMAP.md` or `actions.md` at the root of a repo found in your project folders. Ticking first checks the line still holds the same todo. Deleting a session moves its transcript to the Recycle Bin / Trash after a confirmation, and the path comes from DevCockpit's own index, never from the UI. |
| Claude sessions launched here | The optional todo instruction and any first message are passed as environment variables, never pasted into a shell command. Inherited Claude Code variables (session IDs, tokens) are stripped from every child process. |
| Packaged app | Electron fuses are set: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, ASAR integrity checking, and the app loads only from its own ASAR. The UI is served from a private `app://` scheme rather than `file://`. |
| Supply chain | Few runtime dependencies (one: `node-pty`), exact versions, and a lockfile. CI on every PR typechecks and builds on Windows, macOS and Linux. It fails on high or critical advisories in shipped packages (`npm audit --omit=dev`) and verifies every package's registry signature. CodeQL (security-extended), dependency review and OpenSSF Scorecard run once the repo is public. Dependabot opens weekly update PRs, and Electron gets its own. All GitHub Actions are pinned to commit SHAs and run with least-privilege tokens. Still planned: signed releases. |
