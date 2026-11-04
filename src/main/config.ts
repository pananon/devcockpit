import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Billing, Settings } from '@shared/types';
import { isInstalledOnDisk } from './ollamaInstall';

const file = () => path.join(app.getPath('userData'), 'settings.json');

function defaultRoots(): string[] {
  const home = os.homedir();
  const candidates = [
    ...['Projects', 'projects', 'Project', 'code', 'Code', 'dev', 'src', 'repos', 'workspace', 'GitHub'].map((d) => path.join(home, d)),
    ...(process.platform === 'win32' ? ['C:\\Project', 'C:\\Projects', 'C:\\dev', 'C:\\code'] : []),
  ];
  return [...new Set(candidates)].filter((p) => fs.existsSync(p));
}

const DEFAULTS = {
  backgroundMode: false,
  saveTodos: true,
  billing: 'api' as Billing,
  planPrice: 200,
};

export const MAX_PLAN_PRICE = 10_000;

/** A whole-dollar monthly price, or the default when the value is unusable. */
export function cleanPlanPrice(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), MAX_PLAN_PRICE) : DEFAULTS.planPrice;
}

export function getSettings(): Settings {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Settings>;
    if (Array.isArray(s.projectRoots)) {
      return {
        projectRoots: s.projectRoots.filter((r) => typeof r === 'string'),
        localModel: typeof s.localModel === 'string' ? s.localModel : null,
        backgroundMode: s.backgroundMode === true,
        saveTodos: s.saveTodos !== false,
        // Until chosen, local AI is on only if Ollama is already installed.
        localAi: typeof s.localAi === 'boolean' ? s.localAi : isInstalledOnDisk(),
        billing: s.billing === 'subscription' ? 'subscription' : 'api',
        planPrice: cleanPlanPrice(s.planPrice),
      };
    }
  } catch {
    // first run or unreadable: fall through to defaults
  }
  return { projectRoots: defaultRoots(), localModel: null, ...DEFAULTS, localAi: isInstalledOnDisk() };
}

export function saveSettings(s: Settings): Settings {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(s, null, 2));
  return s;
}
