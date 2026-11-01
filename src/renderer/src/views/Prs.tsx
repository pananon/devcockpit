import type { PullRequest } from '@shared/types';
import type { Actions, Data } from '../App';
import { ago } from '../util';

export function Prs({ data, actions }: { data: Data; actions: Actions }) {
  const { prs } = data;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Pull requests</h1>
          <p className="muted">Across every GitHub repo you can access, through your existing gh login.</p>
        </div>
      </header>
      {prs === null && <p className="muted">Asking GitHub…</p>}
      {prs?.error && <div className="card warn-card">{prs.error}</div>}
      {prs && !prs.error && (
        <div className="grid3">
          <PrColumn title="Waiting for your review" prs={prs.reviewRequested} empty="Nothing to review." actions={actions} />
          <PrColumn title="Your open PRs" prs={prs.mine} empty="No open PRs." actions={actions} />
          <PrColumn title="Recently merged" prs={prs.recentlyMerged} empty="Nothing merged recently." actions={actions} />
        </div>
      )}
    </div>
  );
}

function PrColumn({ title, prs, empty, actions }: { title: string; prs: PullRequest[]; empty: string; actions: Actions }) {
  return (
    <section className="card">
      <h3>
        {title} <span className="muted">({prs.length})</span>
      </h3>
      {prs.length === 0 && <p className="muted">{empty}</p>}
      <ul className="list">
        {prs.map((p) => (
          <li key={p.url} className="list-row" onClick={() => actions.openExternal(p.url)}>
            <div className="grow">
              <div className="title">{p.title}</div>
              <div className="muted small">
                {p.repo} #{p.number} · {p.author} · {ago(p.updatedAt)}
              </div>
            </div>
            {p.isDraft && <span className="chip">draft</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
