// Numbers for the Insights view and Today's "this week" strip, all derived from
// session history (prompts and Claude spend per day) and repo state.
import type { Billing, Repo, SessionSummary } from '@shared/types';
import { baseName, samePath } from './util';

const DAY = 86400_000;
export const NO_REPO = '(no repo)';

/** Local calendar day, matching the keys the main process writes. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The last n days as keys, oldest first, ending today. */
export function lastDays(n: number, end = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => dayKey(new Date(end.getTime() - (n - 1 - i) * DAY)));
}

const sum = (rec: Record<string, number> | undefined, days: string[]) => days.reduce((n, d) => n + (rec?.[d] ?? 0), 0);
export const repoName = (s: SessionSummary) => (s.repoPath ? baseName(s.repoPath) : NO_REPO);

export interface Window {
  prompts: number;
  spend: number;
  sessions: number;
  /** per repo, sorted by prompts */
  byRepo: { repo: string; prompts: number; spend: number }[];
}

export function windowStats(sessions: SessionSummary[], days: string[]): Window {
  const by = new Map<string, { prompts: number; spend: number }>();
  let prompts = 0;
  let spend = 0;
  let count = 0;
  for (const s of sessions) {
    const p = sum(s.promptDays, days);
    const c = sum(s.costDays, days);
    if (!p && !c) continue;
    count++;
    prompts += p;
    spend += c;
    const r = by.get(repoName(s)) ?? { prompts: 0, spend: 0 };
    by.set(repoName(s), { prompts: r.prompts + p, spend: r.spend + c });
  }
  const byRepo = [...by.entries()].map(([repo, v]) => ({ repo, ...v })).sort((a, b) => b.prompts - a.prompts || b.spend - a.spend);
  return { prompts, spend, sessions: count, byRepo };
}

/** This 7 days against the 7 before. */
export function weekCompare(sessions: SessionSummary[]) {
  const days = lastDays(14);
  return { now: windowStats(sessions, days.slice(7)), prev: windowStats(sessions, days.slice(0, 7)) };
}

/** "▲54%" / "▼12%"; null when there's nothing to compare against. */
export function change(now: number, prev: number): { text: string; up: boolean } | null {
  if (!prev) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return { text: '±0%', up: false };
  return { text: `${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}%`, up: pct > 0 };
}

/** Prompts per day per repo, for the stacked chart. */
export function dailyByRepo(sessions: SessionSummary[], days: string[]): Record<string, number>[] {
  return days.map((d) => {
    const row: Record<string, number> = {};
    for (const s of sessions) {
      const n = s.promptDays?.[d];
      if (n) row[repoName(s)] = (row[repoName(s)] ?? 0) + n;
    }
    return row;
  });
}

/** All-time Claude spend per repo, highest first. */
export function spendByRepo(sessions: SessionSummary[]): { repo: string; spend: number }[] {
  const by = new Map<string, number>();
  for (const s of sessions) if (s.costUSD) by.set(repoName(s), (by.get(repoName(s)) ?? 0) + s.costUSD);
  return [...by.entries()].map(([repo, spend]) => ({ repo, spend })).sort((a, b) => b.spend - a.spend);
}

export const COLD_DAYS = 7;

/** Repos with uncommitted work that nobody has touched (no session, no commit) for a week. */
export function goingCold(repos: Repo[], sessions: SessionSummary[]) {
  return repos
    .filter((r) => r.uncommitted.length)
    .map((r) => {
      const last = sessions.find((s) => samePath(s.repoPath, r.path));
      const touched = [last?.updatedAt, r.lastCommit?.date].filter(Boolean).sort().pop() ?? '';
      return { repo: r, last, days: touched ? Math.floor((Date.now() - new Date(touched).getTime()) / DAY) : 999 };
    })
    .filter((c) => c.days >= COLD_DAYS)
    .sort((a, b) => b.days - a.days);
}

export const money = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(2)}`;

// Claude Code records cost at API (per-token) rates, whatever plan the user is on.
export const COST_LABEL = 'API-equivalent cost';

/** Tooltip explaining what the cost figure means for this user's billing. */
export function costHint(billing: Billing, planPrice: number): string {
  return billing === 'subscription'
    ? `What this usage would cost at Claude API rates. Your $${planPrice}/month plan is not billed per token.`
    : 'What this usage costs at Claude API rates, as recorded by Claude Code.';
}

const MONTH_DAYS = 365.25 / 12;

/** The share of a monthly plan price that covers this many days. */
export const planShare = (planPrice: number, days: number) => (planPrice * days) / MONTH_DAYS;

/** "3.2×": how many times over the plan's share for the period the usage was worth. */
export function planMultiple(cost: number, planPrice: number, days: number): string {
  const x = cost / planShare(planPrice, days);
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)}×`;
}

/** "almost half of", "most of"… for the headline. */
export function shareWords(share: number): string {
  if (share >= 0.75) return 'most of';
  if (share >= 0.55) return 'over half of';
  if (share >= 0.42) return 'almost half of';
  if (share >= 0.3) return 'about a third of';
  if (share >= 0.2) return 'about a quarter of';
  return 'the biggest share of';
}
