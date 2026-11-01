// Pull requests via the GitHub CLI, so DevCockpit never stores a GitHub token.
import type { PrBuckets, PullRequest } from '@shared/types';
import { run } from './exec';

const FIELDS = 'repository,number,title,url,author,isDraft,updatedAt,state';

async function search(args: string[]): Promise<PullRequest[]> {
  const out = await run('gh', ['search', 'prs', ...args, '--json', FIELDS, '--limit', '50'], undefined, 30000);
  return (JSON.parse(out) as any[]).map((p) => ({
    repo: p.repository?.nameWithOwner ?? '',
    number: p.number,
    title: p.title,
    url: p.url,
    author: p.author?.login ?? '',
    isDraft: Boolean(p.isDraft),
    updatedAt: p.updatedAt,
    state: p.state,
  }));
}

let cache: { at: number; value: PrBuckets } | null = null;

/** Cached for a minute so the Today brief and the PR view don't each hit GitHub. */
export async function listPrs(force = false): Promise<PrBuckets> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value;
  const value = await fetchPrs();
  if (!value.error) cache = { at: Date.now(), value };
  return value;
}

async function fetchPrs(): Promise<PrBuckets> {
  try {
    const [mine, reviewRequested, recentlyMerged] = await Promise.all([
      search(['--author=@me', '--state=open', '--sort=updated']),
      search(['--review-requested=@me', '--state=open', '--sort=updated']),
      search(['--author=@me', '--merged', '--sort=updated']).then((p) => p.slice(0, 15)),
    ]);
    return { mine, reviewRequested, recentlyMerged, error: null };
  } catch (e: any) {
    const missing = e?.code === 'ENOENT';
    return {
      mine: [],
      reviewRequested: [],
      recentlyMerged: [],
      error: missing
        ? 'GitHub CLI (gh) not found. Install it from https://cli.github.com and run "gh auth login".'
        : 'Could not reach GitHub through gh. Run "gh auth status" in the terminal to check your login.',
    };
  }
}
