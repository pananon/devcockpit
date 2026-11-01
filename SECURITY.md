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
| Browser permissions | Everything is denied except the microphone, and only for audio, only for our own page. Camera, location, notifications and clipboard stay off. |
| Voice data | Audio is held in memory, transcribed by a local Whisper model, then discarded. It's never written to disk or uploaded. Only the model weights are downloaded, once, from Hugging Face. |
| Dictating into other apps | The global shortcut puts the transcribed text on the clipboard and sends exactly one paste keystroke (Ctrl/Cmd+V) to the front app. Your previous clipboard text is then restored. It never types anything else and can be turned off in Settings. |
| Local AI | Ollama is only contacted on loopback (127.0.0.1/localhost), even if `OLLAMA_HOST` points elsewhere. Prompts wrap your data in `<data>` tags and tell the model to ignore instructions inside them, and model output is rendered as React elements, never HTML. Ollama is only installed when you click Install. The official installer then runs visibly in a terminal tab (winget on Windows, which checks the installer's SHA-256). |
| Routines | Claude Code routines run headless with read-only tools (`Read`, `Grep`, `Glob`): no edits and no shell. Your own Claude Code permission rules still apply. On Windows the prompt is passed in an environment variable, so it's never parsed by a shell. Routines that use Claude tokens are labelled as such. |
| Background mode | Off by default. When you turn it on, DevCockpit adds a tray icon and a login item, and both are removed when you turn it off. Nothing else is installed (no services or scheduled tasks). |
| Supply chain | Few dependencies, exact versions, lockfile. Planned: CodeQL, Dependabot, OpenSSF Scorecard, npm provenance, signed releases, Electron fuses. |
