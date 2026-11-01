import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Settings, VoiceModel } from '@shared/types';

const file = () => path.join(app.getPath('userData'), 'settings.json');

function defaultRoots(): string[] {
  const home = os.homedir();
  const candidates = [
    ...['Projects', 'projects', 'Project', 'code', 'Code', 'dev', 'src', 'repos', 'workspace', 'GitHub'].map((d) => path.join(home, d)),
    ...(process.platform === 'win32' ? ['C:\\Project', 'C:\\Projects', 'C:\\dev', 'C:\\code'] : []),
  ];
  return [...new Set(candidates)].filter((p) => fs.existsSync(p));
}

const DEFAULTS = { voiceModel: 'small' as VoiceModel, voiceLanguage: 'english', voiceHotkey: 'CommandOrControl+Shift+Space' as string | null };

export function getSettings(): Settings {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Settings>;
    if (Array.isArray(s.projectRoots)) {
      return {
        projectRoots: s.projectRoots.filter((r) => typeof r === 'string'),
        localModel: typeof s.localModel === 'string' ? s.localModel : null,
        voiceModel: (['base', 'small', 'turbo'] as VoiceModel[]).includes(s.voiceModel as VoiceModel) ? (s.voiceModel as VoiceModel) : DEFAULTS.voiceModel,
        voiceLanguage: typeof s.voiceLanguage === 'string' ? s.voiceLanguage : DEFAULTS.voiceLanguage,
        voiceHotkey: s.voiceHotkey === null || typeof s.voiceHotkey === 'string' ? s.voiceHotkey : DEFAULTS.voiceHotkey,
      };
    }
  } catch {
    // first run or unreadable: fall through to defaults
  }
  return { projectRoots: defaultRoots(), localModel: null, ...DEFAULTS };
}

export function saveSettings(s: Settings): Settings {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(s, null, 2));
  return s;
}
