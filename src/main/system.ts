// Hardware scan used to decide which local models will run well.
import fs from 'node:fs';
import os from 'node:os';
import type { GpuInfo, SystemInfo } from '@shared/types';
import { tryRun } from './exec';

const GB = 1024 ** 3;

async function nvidiaGpus(): Promise<GpuInfo[]> {
  const out = await tryRun('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], undefined, 8000);
  if (!out) return [];
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, mib] = line.split(',').map((s) => s.trim());
      return { name, vendor: 'nvidia', vramGB: Math.round((Number(mib) / 1024) * 10) / 10, dedicated: true };
    });
}

async function windowsGpus(): Promise<GpuInfo[]> {
  // AdapterRAM is capped at 4 GB by WMI, so treat it as a lower bound only.
  const out = await tryRun(
    'powershell.exe',
    ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'],
    undefined,
    10000
  );
  if (!out) return [];
  try {
    const raw = JSON.parse(out);
    return (Array.isArray(raw) ? raw : [raw]).map((g: any) => {
      const name = String(g.Name ?? 'GPU');
      const vendor = /nvidia/i.test(name) ? 'nvidia' : /amd|radeon/i.test(name) ? 'amd' : /intel/i.test(name) ? 'intel' : 'other';
      return { name, vendor, vramGB: g.AdapterRAM ? Math.round((g.AdapterRAM / GB) * 10) / 10 : 0, dedicated: vendor === 'nvidia' || vendor === 'amd' };
    });
  } catch {
    return [];
  }
}

async function macGpus(totalRamGB: number): Promise<GpuInfo[]> {
  const out = await tryRun('system_profiler', ['SPDisplaysDataType', '-json'], undefined, 10000);
  try {
    const items = JSON.parse(out ?? '{}').SPDisplaysDataType ?? [];
    return items.map((g: any) => {
      const name = String(g.sppci_model ?? 'GPU');
      const apple = /apple/i.test(name);
      // Apple Silicon shares memory with the GPU; roughly 70% is usable for models.
      return { name, vendor: apple ? 'apple' : 'other', vramGB: apple ? Math.round(totalRamGB * 0.7) : 0, dedicated: apple };
    });
  } catch {
    return [];
  }
}

function freeDiskGB(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    return Math.round((s.bavail * s.bsize) / GB);
  } catch {
    return null;
  }
}

export async function scanSystem(): Promise<SystemInfo> {
  const cpus = os.cpus();
  const ramGB = Math.round(os.totalmem() / GB);
  let gpus = await nvidiaGpus();
  if (!gpus.length) {
    if (process.platform === 'win32') gpus = await windowsGpus();
    else if (process.platform === 'darwin') gpus = await macGpus(ramGB);
  }
  const best = [...gpus].filter((g) => g.dedicated).sort((a, b) => b.vramGB - a.vramGB)[0] ?? null;
  return {
    platform: process.platform,
    arch: process.arch,
    cpu: cpus[0]?.model.trim() ?? 'Unknown CPU',
    cores: cpus.length,
    ramGB,
    gpus,
    bestGpu: best,
    freeDiskGB: freeDiskGB(os.homedir()),
  };
}
