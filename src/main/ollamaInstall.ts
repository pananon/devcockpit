// Installing and starting Ollama. Installs always run visibly in a DevCockpit
// terminal tab after the user clicks "Install", never silently in the background.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { childEnv } from './exec';

/**
 * The install command for this OS, as a shell script for the terminal tab.
 * Windows uses winget, whose manifest pins the installer's SHA-256; without winget
 * the official installer is downloaded and only run if its Authenticode signature
 * is valid and issued to Ollama. macOS prefers Homebrew. Linux has only the
 * official script.
 */
export function installScript(): string {
  if (process.platform === 'win32') {
    return [
      "Write-Host 'Installing Ollama from the official package...' -ForegroundColor Cyan",
      'if (Get-Command winget -ErrorAction SilentlyContinue) {',
      '  winget install --id Ollama.Ollama --exact --source winget --accept-source-agreements --accept-package-agreements',
      '} else {',
      "  $f = Join-Path $env:TEMP 'OllamaSetup.exe'",
      "  Invoke-WebRequest 'https://ollama.com/download/OllamaSetup.exe' -OutFile $f -UseBasicParsing",
      '  $sig = Get-AuthenticodeSignature $f',
      "  if ($sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match 'Ollama') { Start-Process $f -Wait }",
      "  else { Write-Host \"Signature check failed ($($sig.Status)). Not running the installer.\" -ForegroundColor Red; Remove-Item $f }",
      '}',
      "Write-Host ''; Write-Host 'Done. Go back to the Local AI tab; it will pick Ollama up automatically.' -ForegroundColor Green",
    ].join('\n');
  }
  if (process.platform === 'darwin') {
    return [
      'echo "Installing Ollama..."',
      'if command -v brew >/dev/null 2>&1; then brew install --cask ollama && open -a Ollama;',
      'else curl -fsSL https://ollama.com/install.sh | sh; fi',
      'echo; echo "Done. Go back to the Local AI tab; it will pick Ollama up automatically."',
    ].join('\n');
  }
  return [
    'echo "Installing Ollama with the official script (it will ask for your sudo password)..."',
    'curl -fsSL https://ollama.com/install.sh | sh',
    'echo; echo "Done. Go back to the Local AI tab; it will pick Ollama up automatically."',
  ].join('\n');
}

/** Where installers put Ollama, since a fresh install isn't on PATH for already-running apps. */
function knownBinary(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Ollama', 'ollama.exe')]
      : process.platform === 'darwin'
        ? ['/Applications/Ollama.app/Contents/Resources/ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama']
        : ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export const isInstalledOnDisk = () => knownBinary() != null;

/**
 * Starts only the local Ollama server (`ollama serve` on 127.0.0.1:11434): no app
 * window and no account sign-in, which local models don't need. (Relaunching the
 * desktop app doesn't help when it's already open but stuck on its first-run screen.)
 */
export function startOllama(): boolean {
  const bin = knownBinary();
  if (bin) {
    spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv({ OLLAMA_HOST: '127.0.0.1:11434' }) }).unref();
    return true;
  }
  if (process.platform === 'darwin' && fs.existsSync('/Applications/Ollama.app')) {
    spawn('open', ['-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  return false;
}
