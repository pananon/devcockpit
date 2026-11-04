// Looks through a skill's files for things a person should see before trusting it.
// A skill is instructions Claude follows (and sometimes scripts it runs), so saving
// one and installing it in other repos spreads whatever it contains. The scanner
// can't prove a skill is safe; it points the review at the lines that matter.
import type { SkillFile, SkillFinding, SkillSourceKind } from '@shared/types';

type Rule = { level: SkillFinding['level']; re: RegExp; message: string };

/** Credentials pasted into a skill. These block installing into a repo, where they'd be committed. */
const SECRETS: Rule[] = [
  { level: 'danger', re: /sk-ant-[a-z0-9_-]{20,}/i, message: 'Looks like an Anthropic API key' },
  { level: 'danger', re: /\bsk-(proj-)?[a-z0-9]{20,}/i, message: 'Looks like an OpenAI-style API key' },
  { level: 'danger', re: /\b(ghp|gho|ghu|ghs|ghr)_[a-z0-9]{30,}|github_pat_[a-z0-9_]{40,}/i, message: 'Looks like a GitHub token' },
  { level: 'danger', re: /\bAKIA[0-9A-Z]{16}\b/, message: 'Looks like an AWS access key' },
  { level: 'danger', re: /\bAIza[0-9A-Za-z_-]{35}\b/, message: 'Looks like a Google API key' },
  { level: 'danger', re: /\bxox[abprs]-[a-z0-9-]{10,}/i, message: 'Looks like a Slack token' },
  { level: 'danger', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, message: 'Contains a private key' },
  { level: 'danger', re: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, message: 'Looks like a hard-coded secret' },
];

const RISKY: Rule[] = [
  // Downloading and running code in one step skips any review.
  { level: 'danger', re: /\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, message: 'Downloads a script and runs it straight away' },
  { level: 'danger', re: /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|\n]*\|\s*iex\b|\biex\s*\(\s*(iwr|irm|New-Object\s+Net\.WebClient)/i, message: 'Downloads a PowerShell script and runs it straight away' },
  { level: 'danger', re: /base64\s+(-d|--decode)[^|\n]*\|\s*(ba|z)?sh\b|FromBase64String/i, message: 'Decodes hidden content and runs it' },
  { level: 'danger', re: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME)(\s|$)/i, message: 'Deletes a home or root folder' },
  { level: 'danger', re: /--dangerously-skip-permissions|bypassPermissions/i, message: 'Turns off Claude Code permission prompts' },
  { level: 'danger', re: /ignore (all |any )?(previous|prior|above|earlier) instructions/i, message: 'Tries to override earlier instructions (prompt injection)' },
  { level: 'warn', re: /\b(do not|don't|never) (tell|inform|show|mention to) the user\b|without (asking|telling) the user/i, message: 'Asks Claude to hide something from you' },
  { level: 'warn', re: /~\/\.ssh|\bid_(rsa|ed25519)\b|\.aws\/credentials|\.netrc\b|\.npmrc\b|\.git-credentials/i, message: 'Reads credential files' },
  { level: 'warn', re: /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|AWS_SECRET_ACCESS_KEY|NPM_TOKEN)\b/, message: 'Uses a credential environment variable' },
  { level: 'warn', re: /\bcat\s+[^\n]*\.env\b|\bsource\s+[^\n]*\.env\b/i, message: 'Reads a .env file' },
  { level: 'warn', re: /\b(curl|wget|Invoke-WebRequest|fetch)\b[^\n]*(-d\b|--data|-F\b|--upload-file|-X\s*POST|method:\s*['"]POST)/i, message: 'Sends data to a web address' },
  { level: 'warn', re: /\bchmod\s+\+x\b|\bsudo\b/, message: 'Makes files executable or runs as administrator' },
  { level: 'warn', re: /\$\{?CLAUDE_PLUGIN_ROOT\}?/, message: "Refers to its plugin's folder; outside the plugin those paths won't exist" },
];

/** Invisible or direction-flipping characters can hide text from a reviewer. */
const HIDDEN = /[​-‏‪-‮⁦-⁩﻿­]/;

const SCRIPT = /\.(sh|bash|zsh|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php|exe|dll|so|dylib)$/i;

/** The frontmatter's allowed-tools line pre-approves tools while the skill runs. */
function allowedTools(text: string): string | null {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = fm?.[1].match(/^allowed-tools:\s*(.+)$/m);
  return line ? line[1].trim() : null;
}

export function scanSkill(files: SkillFile[], sourceKind: SkillSourceKind, sourceLabel: string): SkillFinding[] {
  const out: SkillFinding[] = [];
  const add = (f: SkillFinding) => out.length < 200 && out.push(f);

  if (sourceKind === 'plugin')
    add({
      level: 'info',
      file: 'SKILL.md',
      line: null,
      message: `From the ${sourceLabel.replace(/^plugin /, '')} plugin. It may rely on that plugin's tools or connectors, which aren't copied. Check the plugin's licence before sharing it.`,
    });

  for (const f of files) {
    if (f.text === null) {
      add({ level: 'warn', file: f.path, line: null, message: "Binary file: it can't be reviewed here" });
      continue;
    }
    if (SCRIPT.test(f.path)) add({ level: 'warn', file: f.path, line: null, message: 'Script Claude may run. Read it before trusting the skill.' });
    if (f.path === 'SKILL.md') {
      const tools = allowedTools(f.text);
      if (tools && /\bBash\b|\*/.test(tools)) add({ level: 'warn', file: f.path, line: null, message: `Pre-approves tools without asking: ${tools.slice(0, 120)}` });
    }
    const lines = f.text.split(/\r?\n/);
    lines.forEach((text, i) => {
      if (HIDDEN.test(text)) add({ level: 'danger', file: f.path, line: i + 1, message: 'Contains invisible characters that can hide text' });
      for (const r of [...SECRETS, ...RISKY]) if (r.re.test(text)) add({ level: r.level, file: f.path, line: i + 1, message: r.message });
    });
  }
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

const SECRET_MESSAGES = new Set(SECRETS.map((r) => r.message));

/** Secrets would be committed and pushed with the repo, so they block repo installs outright. */
export const hasSecrets = (findings: SkillFinding[]) => findings.some((f) => SECRET_MESSAGES.has(f.message));
