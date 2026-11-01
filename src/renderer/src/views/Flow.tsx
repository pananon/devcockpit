import { useState } from 'react';
import type { Repo } from '@shared/types';
import type { Actions, Data } from '../App';
import { ago, repoColor, samePath } from '../util';

type Filter = 'all' | 'week';
const WEEK = 7 * 86400_000;
const STALE_DAYS = 7;

/** Work as a pipeline: in progress → ready to push → in review → shipped. */
export function Flow({ data, actions }: { data: Data; actions: Actions }) {
  const [filter, setFilter] = useState<Filter>('all');
  const repos = data.repos ?? [];
  const sessions = data.sessions ?? [];
  const lastSession = (r: Repo) => sessions.find((s) => samePath(s.repoPath, r.path));
  const touched = (r: Repo) => lastSession(r)?.updatedAt ?? r.lastCommit?.date ?? '';
  const days = (iso: string) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000) : 999);
  const inWindow = (iso: string) => filter === 'all' || Date.now() - new Date(iso || 0).getTime() < WEEK;

  const inProgress = repos.filter((r) => r.uncommitted.length && inWindow(touched(r))).sort((a, b) => touched(b).localeCompare(touched(a)));
  const ready = repos.filter((r) => r.ahead > 0 && inWindow(touched(r)));
  const review = (data.prs?.mine ?? []).filter((p) => inWindow(p.updatedAt));
  const merged = (data.prs?.recentlyMerged ?? []).filter((p) => Date.now() - new Date(p.updatedAt).getTime() < WEEK);
  // Commits from the last week on repos that are fully pushed count as shipped.
  const pushed = repos
    .filter((r) => r.hasUpstream && r.ahead === 0)
    .flatMap((r) => r.recentCommits.filter((c) => Date.now() - new Date(c.date).getTime() < WEEK).slice(0, 3).map((c) => ({ r, c })))
    .sort((a, b) => b.c.date.localeCompare(a.c.date))
    .slice(0, 8);

  const card = (key: string, color: string, title: string, meta: string, metaColor: string, right?: string, action?: { label: string; run: () => void }, rightColor?: string) => (
    <div key={key} className="flow-card" style={{ borderLeftColor: color }}>
      <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
        <span className="led" style={{ background: color }} />
        <strong className="title grow">{title}</strong>
        {right && (
          <span className="mono small" style={{ color: rightColor ?? 'var(--muted)' }}>
            {right}
          </span>
        )}
      </div>
      <div className="mono small title" style={{ color: metaColor }}>
        {meta}
      </div>
      {action && (
        <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={action.run}>
          {action.label} →
        </button>
      )}
    </div>
  );

  const column = (n: number, title: string, color: string, count: number, children: React.ReactNode, empty: string) => (
    <section className="flow-col" style={{ borderTopColor: color }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label" style={{ color }}>
          {n} · {title}
        </span>
        <span className="mono small muted">{count}</span>
      </div>
      {count === 0 && <p className="muted small">{empty}</p>}
      {children}
    </section>
  );

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <header className="page-head">
        <div>
          <div className="label">Work pipeline · all repos</div>
          <h1 style={{ margin: '6px 0 0' }}>Move work to the right</h1>
        </div>
        <div className="seg" style={{ padding: 0, width: 260 }}>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            Everything
          </button>
          <button className={filter === 'week' ? 'active' : ''} onClick={() => setFilter('week')}>
            Active this week
          </button>
        </div>
      </header>

      <div className="flow">
        {column(
          1,
          'In progress',
          'var(--warn)',
          inProgress.length,
          inProgress.map((r) => {
            const d = days(touched(r));
            const last = lastSession(r);
            return card(
              r.path,
              repoColor(r.name),
              r.name,
              `${r.uncommitted.length} changed · ${r.branch}`,
              'var(--warn)',
              d >= STALE_DAYS ? `❄ ${d}d` : d === 0 ? 'today' : `${d}d`,
              last ? { label: 'Resume session', run: () => actions.openClaude(r.path, { resumeId: last.id, title: last.title }) } : { label: 'Open', run: () => actions.go('workspace', r.path) },
              d >= STALE_DAYS ? 'var(--danger)' : undefined
            );
          }),
          'Nothing uncommitted.'
        )}
        {column(
          2,
          'Ready to push',
          'var(--info)',
          ready.length,
          <>
            {ready.map((r) => card(r.path, repoColor(r.name), r.name, `${r.ahead} commit${r.ahead === 1 ? '' : 's'} ahead · ${r.branch}`, 'var(--info)', undefined, { label: 'Open shell to push', run: () => actions.openShell(r.path) }))}
            {ready.length > 0 && <p className="mono small muted">Committed but not on GitHub yet. DevCockpit never pushes for you.</p>}
          </>,
          'Nothing waiting to be pushed.'
        )}
        {column(
          3,
          'In review',
          '#b48cff',
          review.length,
          review.map((p) => {
            const name = p.repo.split('/')[1];
            return card(p.url, repoColor(name), `#${p.number} ${p.title}`, `${name} · ${p.isDraft ? 'draft' : 'open'} · ${ago(p.updatedAt)}`, 'var(--muted)', undefined, { label: 'Open PR', run: () => actions.openExternal(p.url) });
          }),
          data.prs?.error ?? 'No open pull requests.'
        )}
        {column(
          4,
          'Shipped this week',
          'var(--ok)',
          merged.length + pushed.length,
          <>
            {merged.map((p) => {
              const name = p.repo.split('/')[1];
              return card(p.url, repoColor(name), p.title, `${name} · merged ${ago(p.updatedAt)}`, 'var(--ok)');
            })}
            {pushed.map(({ r, c }) => card(`${r.path}-${c.hash}`, repoColor(r.name), c.subject, `${r.name} · pushed · ${ago(c.date)}`, 'var(--muted)'))}
          </>,
          'Nothing shipped in the last 7 days.'
        )}
      </div>
    </div>
  );
}
