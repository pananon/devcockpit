// Curated local-model catalog and hardware-fit logic.
// Sizes here are Q4 estimates; exact sizes are fetched from the Ollama registry.
import type { CatalogModel, ModelFit, ModelOption, ModelReport, SystemInfo } from '@shared/types';

export const CATALOG: CatalogModel[] = [
  { tag: 'qwen3.5:27b', family: 'Qwen 3.5', paramsB: 27, approxGB: 17, quality: 10, use: 'general', blurb: 'Top quality, multimodal. Needs a big GPU.' },
  { tag: 'gemma4:26b', family: 'Gemma 4', paramsB: 26, approxGB: 17, quality: 9.5, use: 'general', blurb: "Google's strongest open model that fits on one GPU." },
  { tag: 'qwen3.5:9b', family: 'Qwen 3.5', paramsB: 9, approxGB: 6.6, quality: 8.5, use: 'general', blurb: 'Best all-rounder for 8 GB GPUs. Multimodal.' },
  { tag: 'gemma4:12b', family: 'Gemma 4', paramsB: 12, approxGB: 8.1, quality: 8.3, use: 'general', blurb: 'Strong writing and summaries. Needs ~10 GB.' },
  { tag: 'qwen3:14b', family: 'Qwen 3', paramsB: 14, approxGB: 9.3, quality: 8, use: 'general', blurb: 'Proven, great at reasoning and tools.' },
  { tag: 'gemma4:e4b', family: 'Gemma 4', paramsB: 8, approxGB: 7.5, quality: 7.5, use: 'general', blurb: 'Efficient on-device model, good quality per GB.' },
  { tag: 'qwen3:8b', family: 'Qwen 3', paramsB: 8, approxGB: 5.2, quality: 7.2, use: 'general', blurb: 'Fast and reliable on 6 to 8 GB GPUs.' },
  { tag: 'granite4.2:8b', family: 'Granite 4.2', paramsB: 8, approxGB: 5, quality: 7, use: 'general', blurb: "IBM's model, tuned for tool use and structured output." },
  { tag: 'qwen3.5:4b', family: 'Qwen 3.5', paramsB: 4, approxGB: 3.4, quality: 7, use: 'general', blurb: 'Small but capable. Good on laptops.' },
  { tag: 'qwen3:4b', family: 'Qwen 3', paramsB: 4, approxGB: 2.5, quality: 6.2, use: 'general', blurb: 'Light and quick, even on CPU.' },
  { tag: 'gemma4:e2b', family: 'Gemma 4', paramsB: 5, approxGB: 7.2, quality: 6, use: 'general', blurb: 'Tiny effective size, made for low-power devices.' },
  { tag: 'granite4.2:3b', family: 'Granite 4.2', paramsB: 3, approxGB: 2.1, quality: 5.5, use: 'general', blurb: 'Very small, good at short structured tasks.' },
  { tag: 'qwen3.5:2b', family: 'Qwen 3.5', paramsB: 2, approxGB: 2, quality: 5, use: 'general', blurb: 'For older machines. Basic summaries only.' },
  { tag: 'llama3.2:3b', family: 'Llama 3.2', paramsB: 3, approxGB: 2, quality: 4.5, use: 'general', blurb: 'Classic small model, runs almost anywhere.' },
  { tag: 'qwen2.5-coder:7b', family: 'Qwen 2.5 Coder', paramsB: 7, approxGB: 4.7, quality: 7, use: 'code', blurb: 'Code completion and explanations.' },
  { tag: 'qwen2.5-coder:14b', family: 'Qwen 2.5 Coder', paramsB: 14, approxGB: 9, quality: 8, use: 'code', blurb: 'Stronger coding model for 12 GB+ GPUs.' },
  { tag: 'deepseek-r1:8b', family: 'DeepSeek R1', paramsB: 8, approxGB: 5.2, quality: 7, use: 'reasoning', blurb: 'Thinks step by step. Slower, better at logic.' },
];

/** Room for the context window and runtime on top of the weights. */
const OVERHEAD_GB = 1.2;

const sizeCache = new Map<string, number>();

/** Exact download size from the Ollama registry, or null if unreachable. */
async function registrySizeGB(tag: string): Promise<number | null> {
  if (sizeCache.has(tag)) return sizeCache.get(tag)!;
  const [name, version] = tag.split(':');
  try {
    const res = await fetch(`https://registry.ollama.ai/v2/library/${encodeURIComponent(name)}/manifests/${encodeURIComponent(version ?? 'latest')}`, {
      headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const m = (await res.json()) as { layers?: { size?: number }[] };
    const bytes = (m.layers ?? []).reduce((n, l) => n + (l.size ?? 0), 0);
    if (!bytes) return null;
    const gb = Math.round((bytes / 1024 ** 3) * 10) / 10;
    sizeCache.set(tag, gb);
    return gb;
  } catch {
    return null;
  }
}

function fitFor(sizeGB: number, paramsB: number, sys: SystemInfo): { fit: ModelFit; reason: string } {
  const need = sizeGB + OVERHEAD_GB;
  const vram = sys.bestGpu?.vramGB ?? 0;
  if (vram && need <= vram) return { fit: 'gpu', reason: `Fits fully in your ${vram} GB of GPU memory, so it'll be fast.` };
  if (vram && need <= vram + sys.ramGB * 0.5) return { fit: 'partial', reason: `Needs ~${Math.ceil(need)} GB, more than your GPU's ${vram} GB. Part of it runs on the CPU, so it'll be slower.` };
  if (!vram && need <= sys.ramGB * 0.6) {
    return paramsB <= 4
      ? { fit: 'cpu', reason: 'Runs on your CPU at a usable speed.' }
      : { fit: 'partial', reason: 'Runs on your CPU, but slowly at this size.' };
  }
  return { fit: 'no', reason: `Needs ~${Math.ceil(need)} GB of memory. Too big for this machine.` };
}

const FIT_RANK: Record<ModelFit, number> = { gpu: 3, cpu: 2, partial: 1, no: 0 };

export async function buildReport(sys: SystemInfo): Promise<ModelReport> {
  const sizes = await Promise.all(CATALOG.map((m) => registrySizeGB(m.tag)));
  const options: ModelOption[] = CATALOG.map((m, i) => {
    const sizeGB = sizes[i] ?? m.approxGB;
    return { ...m, sizeGB, sizeExact: sizes[i] != null, ...fitFor(sizeGB, m.paramsB, sys) };
  });
  // Best general model with the best fit class available on this machine.
  const general = options.filter((o) => o.use === 'general' && o.fit !== 'no');
  const bestFit = Math.max(0, ...general.map((o) => FIT_RANK[o.fit]));
  const recommended = general.filter((o) => FIT_RANK[o.fit] === bestFit).sort((a, b) => b.quality - a.quality)[0] ?? null;
  const fast = general
    .filter((o) => o.fit === 'gpu' || o.fit === 'cpu')
    .sort((a, b) => a.sizeGB - b.sizeGB)
    .find((o) => o.quality >= 6) ?? null;
  return {
    system: sys,
    options: options.sort((a, b) => FIT_RANK[b.fit] - FIT_RANK[a.fit] || b.quality - a.quality),
    recommended: recommended?.tag ?? null,
    fastPick: fast && fast.tag !== recommended?.tag ? fast.tag : null,
  };
}

/** Ollama model tag, e.g. "qwen3.5:9b" or "library/name:tag". */
export const isValidTag = (tag: string) => /^[a-z0-9][a-z0-9._/-]{0,80}(:[a-z0-9._-]{1,40})?$/i.test(tag);
