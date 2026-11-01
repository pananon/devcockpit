## Install

- **Windows:** download `DevCockpit-*-windows-x64-setup.exe` and run it. It isn't code-signed yet, so Windows SmartScreen will warn: click **More info → Run anyway**.
- **macOS:** `arm64.dmg` for Apple Silicon, `x64.dmg` for Intel. It's unsigned, so the first time, right-click the app and choose **Open**.
- **Linux:** download the `.AppImage`, run `chmod +x` on it, then run it.

## Verify your download

Every file is built by this repo's GitHub Actions and signed with a build attestation:

```
gh attestation verify <downloaded-file> --repo pananon/devcockpit
```

Checksums are in `SHA256SUMS.txt`. See the README for known limitations.
