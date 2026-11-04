import type { Actions, Data } from '../App';
import { COST_LABEL, costHint, dailyByRepo, goingCold, lastDays, money, NO_REPO, planMultiple, shareWords, spendByRepo, windowStats } from '../insights';
import { plural, repoColor } from '../util';

const DAYS = 14;
const MAX_SERIES = 6;
const OTHER = 'other';
const OTHER_COLOR = '#4b5a68';

const colorOf = (repo: string) => (repo === OTHER || repo === NO_REPO ? OTHER_COLOR : repoColor(repo));
const shortDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Where your Claude Code time and money went over the last two weeks. */
export function Insights({ data, actions }: { data: Data; actions: Actions }) {
  const sessions = data.sessions ?? [];
  const repos = data.repos ?? [];
  const days = lastDays(DAYS);
  const stats = windowStats(sessions, days);
  const cold = goingCold(repos, sessions);
  const spend = spendByRepo(sessions);
  const allTime = spend.reduce((n, s) => n + s.spend, 0);
  const hint = costHint(data.billing, data.planPrice);

  // The biggest repos get their own colour in the chart; the rest share one.
  const series = stats.byRepo.slice(0, MAX_SERIES).map((r) => r.repo);
  const daily = dailyByRepo(sessions, days).map((row) => {
    const out: Record<string, number> = {};
    for (const [repo, n] of Object.entries(row)) {
      const key = series.includes(repo) ? repo : OTHER;
      out[key] = (out[key] ?? 0) + n;
    }
    return out;
  });
  const totals = daily.map((row) => Object.values(row).reduce((a, b) => a + b, 0));
  const peak = Math.max(1, ...totals);
  const peakDay = totals.indexOf(peak);
  const order = [...series, OTHER];

  // Runs of 3+ empty days get a "N quiet days" label instead of empty space.
  const quiet: { start: number; len: number }[] = [];
  for (let i = 0; i < totals.length; ) {
    let j = i;
    while (j < totals.length && totals[j] === 0) j++;
    if (j - i >= 3) quiet.push({ start: i, len: j - i });
    i = Math.max(j, i + 1);
  }

  const top = stats.byRepo[0];
  const warm = (c: (typeof cold)[number]) =>
    c.last ? actions.openClaude(c.repo.path, { resumeId: c.last.id, title: c.last.title }) : actions.openClaude(c.repo.path);

  if (data.sessions && !stats.prompts) {
    return (
      <div className="page">
        <h1>Insights</h1>
        <p className="muted">No Claude Code activity in the last two weeks. Once you've used it, this page shows where your time and usage went.</p>
      </div>
    );
  }

  return (
    <div className="page insights" style={{ maxWidth: 'none' }}>
      <div className="label" style={{ color: 'var(--muted)' }}>
        Insights · {shortDate(days[0])} – {shortDate(days[DAYS - 1])}
      </div>

      <header className="ins-head">
        <h1 className="ins-headline">
          {top ? (
            <>
              You put <em>{shareWords(top.prompts / stats.prompts)}</em> the last two weeks into <span style={{ color: colorOf(top.repo), whiteSpace: 'nowrap' }}>{top.repo}</span>
              {cold.length ? `, and ${cold.length === 1 ? 'one repo is' : `${cold.length} repos are`} going cold.` : ', and nothing is going cold.'}
            </>
          ) : (
            'Reading your session history…'
          )}
        </h1>
        <div className="ins-stats">
          {[
            [stats.prompts, 'prompts'],
            [money(stats.spend), COST_LABEL, hint],
            ...(data.billing === 'subscription' ? [[planMultiple(stats.spend, data.planPrice, DAYS), "of your plan's share", hint]] : []),
            [stats.byRepo.filter((r) => r.repo !== NO_REPO).length, 'repos touched'],
            [stats.sessions, 'sessions'],
          ].map(([n, label, title]) => (
            <div key={label} title={title as string | undefined}>
              <div className="ins-num">{n}</div>
              <div className="label">{label}</div>
            </div>
          ))}
        </div>
      </header>

      <section className="ins-main">
        <div className="panel" style={{ padding: '16px 18px' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="label">Prompts per day, by repo</span>
            <span className="mono small muted">from your Claude Code session history</span>
          </div>
          <div className="ins-chart" role="img" aria-label={`Prompts per day over ${DAYS} days; busiest day ${shortDate(days[peakDay])} with ${peak}`}>
            {quiet.map((q) => (
              <span key={q.start} className="ins-quiet" style={{ left: `${(q.start / DAYS) * 100}%`, width: `${(q.len / DAYS) * 100}%` }}>
                {q.len} quiet days
              </span>
            ))}
            {daily.map((row, i) => (
              <div key={days[i]} className="ins-col" title={`${shortDate(days[i])}: ${plural(totals[i], 'prompt')}`}>
                {i === peakDay && totals[i] > 0 && (
                  <span className="ins-peak mono small" style={{ color: colorOf(Object.entries(row).sort((a, b) => b[1] - a[1])[0][0]) }}>
                    {Object.entries(row).sort((a, b) => b[1] - a[1])[0][0]} · {totals[i]}
                  </span>
                )}
                <div className="ins-stack" style={{ height: `${(totals[i] / peak) * 100}%` }}>
                  {order
                    .filter((r) => row[r])
                    .map((r) => (
                      <div key={r} style={{ flexGrow: row[r], background: colorOf(r) }} />
                    ))}
                </div>
                <span className={`ins-day mono small ${i === DAYS - 1 ? 'today' : ''}`}>{i === DAYS - 1 ? 'today' : days[i].slice(8).replace(/^0/, '')}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel" style={{ padding: '16px 18px' }}>
          <div className="label" style={{ marginBottom: 12 }}>
            Where it went · {DAYS} days
          </div>
          {stats.byRepo.slice(0, 8).map((r) => (
            <div key={r.repo} className="ins-bar">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="title">{r.repo}</span>
                <span className="mono small" style={{ color: colorOf(r.repo) }}>
                  {r.prompts}
                </span>
              </div>
              <div className="ins-track">
                <div style={{ width: `${(r.prompts / (top?.prompts || 1)) * 100}%`, background: colorOf(r.repo) }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="ins-foot">
        <div className="panel" style={{ padding: '16px 18px' }}>
          <div className="label" style={{ color: 'var(--warn)', marginBottom: 12 }}>
            Going cold · uncommitted and untouched
          </div>
          {cold.length === 0 && <p className="muted small">Nothing. Every repo with uncommitted work was touched this week.</p>}
          {cold.slice(0, 5).map((c) => (
            <div key={c.repo.path} className="ins-cold">
              <span className="ins-cold-days" style={{ color: c.days >= 21 ? 'var(--danger, #ff6b8a)' : 'var(--warn)' }}>
                {c.days >= 999 ? '—' : `${c.days}d`}
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <a className="title" style={{ fontWeight: 500 }} onClick={() => actions.go('workspace', c.repo.path)}>
                  {c.repo.name}
                </a>
                <div className="mono small muted title">
                  {plural(c.repo.uncommitted.length, 'file')} on {c.repo.branch}
                </div>
              </div>
              <button className="btn small" onClick={() => warm(c)} title={c.last ? `Resume “${c.last.title}”` : 'Start a Claude session here'}>
                Warm it up
              </button>
            </div>
          ))}
        </div>

        <div className="panel" style={{ padding: '16px 18px' }}>
          <div className="label" style={{ marginBottom: 12 }} title={hint}>
            {COST_LABEL} by repo · all time {money(allTime)}
          </div>
          {spend.slice(0, 8).map((s) => {
            const repo = repos.find((r) => r.name === s.repo);
            return (
              <div key={s.repo} className="row mono small" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                <a className="title" style={{ color: 'var(--text)' }} onClick={() => repo && actions.go('workspace', repo.path)}>
                  <span className="led" style={{ background: colorOf(s.repo), marginRight: 8 }} />
                  {s.repo}
                </a>
                <span style={{ color: 'var(--ok)' }}>{money(s.spend)}</span>
              </div>
            );
          })}
          {!spend.length && <p className="muted small">No cost data in your sessions yet.</p>}
        </div>
      </section>
    </div>
  );
}
