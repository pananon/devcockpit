export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** "1 prompt", "3 prompts" */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const baseName =(p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export const samePath = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

const REPO_COLORS = ['#38c8ff', '#3ee0a0', '#ff6b8a', '#f5a524', '#b48cff', '#ffd166', '#6d8bff', '#f78c6b', '#a3e635', '#c0c8d8'];

const hashName = (name: string) => {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};

/** Colours handed out so far, per lower-cased repo name. */
const assigned = new Map<string, string>();

/**
 * Gives each known repo its own colour: its hash picks a slot, and a taken slot
 * moves to the next free one. The most active repos register first, so they win
 * the clean colours. Unknown names fall back to their hash colour.
 */
export function registerRepos(names: string[]) {
  const used = new Set(assigned.values());
  for (const n of names) {
    const key = n.toLowerCase();
    if (assigned.has(key)) continue;
    let i = hashName(n) % REPO_COLORS.length;
    for (let tries = 0; tries < REPO_COLORS.length && used.has(REPO_COLORS[i]); tries++) i = (i + 1) % REPO_COLORS.length;
    assigned.set(key, REPO_COLORS[i]);
    used.add(REPO_COLORS[i]);
  }
}

/** A repo's identity colour, the same on every screen. */
export function repoColor(name: string | null | undefined): string {
  if (!name) return '#6f8aa3';
  return assigned.get(name.toLowerCase()) ?? REPO_COLORS[hashName(name) % REPO_COLORS.length];
}

/** Translucent version of a hex colour for borders and fills. */
export function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
