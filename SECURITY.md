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
| Credential theft | No tokens stored. GitHub access goes through the user's own `gh` login. No telemetry. |
| Browser permissions | Camera, microphone, location and notifications are all denied by default. Each will be enabled only when a feature needs it. |
| Supply chain | Few dependencies, exact versions, lockfile. Planned: CodeQL, Dependabot, OpenSSF Scorecard, npm provenance, signed releases, Electron fuses. |
