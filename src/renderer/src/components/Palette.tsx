import { useEffect, useMemo, useRef, useState } from 'react';
import type { Actions, Data } from '../App';
import { NAV } from '../App';
import { ago, baseName, plural, repoColor, samePath } from '../util';

interface Item {
  id: string;
  group: string;
  label: string;
  sub?: string;
  color?: string;
  hint?: string;
  run: () => void;
}

/** Substring match beats in-order letters ("dcp" finds "devcockpit"); -1 = no match. */
function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i >= 0) return 100 - Math.min(i, 50) + (i === 0 ? 20 : 0);
  let pos = 0;
  for (const ch of q) {
    pos = t.indexOf(ch, pos);
    if (pos < 0) return -1;
    pos++;
  }
  return 10;
}

export function Palette({ data, actions, onClose }: { data: Data; actions: Actions; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const items = useMemo<Item[]>(() => {
    const run = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const repos = data.repos ?? [];
    const sessions = data.sessions ?? [];
    const prs = [...(data.prs?.reviewRequested ?? []), ...(data.prs?.mine ?? [])];

    const rankedRepos = repos
      .map((r) => ({ r, s: score(q, r.name) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || (b.r.lastCommit?.date ?? '').localeCompare(a.r.lastCommit?.date ?? ''));

    const out: Item[] = [];
    const top = q ? rankedRepos[0] : undefined;
    // A clear repo match gets its actions right away.
    if (top && top.s >= 80) {
      const r = top.r;
      const c = repoColor(r.name);
      const last = sessions.find((s) => samePath(s.repoPath, r.path));
      if (last) out.push({ id: `resume-${last.id}`, group: 'Best match', label: `Resume “${last.title}”`, sub: `${r.name} · ${ago(last.updatedAt)}`, color: c, hint: '↵', run: run(() => actions.openClaude(r.path, { resumeId: last.id, title: last.title })) });
      out.push(
        { id: `new-${r.path}`, group: `Actions on ${r.name}`, label: 'New Claude session here', color: c, run: run(() => actions.openClaude(r.path)) },
        { id: `shell-${r.path}`, group: `Actions on ${r.name}`, label: 'Open shell', color: c, run: run(() => actions.openShell(r.path)) },
        { id: `focus-${r.path}`, group: `Actions on ${r.name}`, label: 'Focus on this repo', color: c, hint: 'Ctrl+.', run: run(() => actions.focus(r.path)) },
        { id: `ws-${r.path}`, group: `Actions on ${r.name}`, label: 'Open in workspace', color: c, run: run(() => actions.go('workspace', r.path)) }
      );
      if (r.github) out.push({ id: `gh-${r.path}`, group: `Actions on ${r.name}`, label: 'Open on GitHub', color: c, run: run(() => actions.openExternal(`https://github.com/${r.github}`)) });
    }

    for (const { r } of rankedRepos.slice(0, q ? 5 : 4)) {
      if (top && top.s >= 80 && r === top.r) continue;
      const bits = [r.uncommitted.length ? `${r.uncommitted.length} changed` : 'clean', `⎇ ${r.branch}`, r.ahead ? `↑${r.ahead}` : ''].filter(Boolean);
      out.push({ id: `repo-${r.path}`, group: 'Repos', label: r.name, sub: bits.join(' · '), color: repoColor(r.name), run: run(() => actions.go('workspace', r.path)) });
    }

    sessions
      .map((s) => ({ s, sc: score(q, `${s.title} ${s.repoPath ? baseName(s.repoPath) : ''}`) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => b.sc - a.sc || b.s.updatedAt.localeCompare(a.s.updatedAt))
      .slice(0, q ? 6 : 5)
      .forEach(({ s }) => {
        const repo = s.repoPath ? baseName(s.repoPath) : null;
        out.push({
          id: `s-${s.id}`,
          group: q ? 'Sessions' : 'Recent sessions',
          label: s.title,
          sub: `${repo ?? 'no repo'} · ${ago(s.updatedAt)} · ${plural(s.userTurns, 'prompt')}`,
          color: repoColor(repo),
          hint: 'resume',
          run: run(() => actions.openClaude(s.repoPath ?? s.cwd, { resumeId: s.id, title: s.title })),
        });
      });

    prs
      .filter((p) => score(q, `${p.repo} ${p.title} #${p.number}`) >= 0)
      .slice(0, q ? 4 : 0)
      .forEach((p) =>
        out.push({ id: `pr-${p.url}`, group: 'Pull requests', label: p.title, sub: `${p.repo}#${p.number} · ${ago(p.updatedAt)}`, color: repoColor(p.repo.split('/')[1]), run: run(() => actions.openExternal(p.url)) })
      );

    NAV.filter((n) => score(q, `go to ${n.label}`) >= 0).forEach((n) =>
      out.push({ id: `nav-${n.view}`, group: 'Go to', label: n.label, hint: `g ${n.key}`, run: run(() => actions.go(n.view)) })
    );
    if (score(q, 'focus mode') >= 0) out.push({ id: 'focus', group: 'Go to', label: 'Focus mode', hint: 'Ctrl+.', run: run(() => actions.focus()) });
    if (score(q, 'settings') >= 0) out.push({ id: 'settings', group: 'Go to', label: 'Settings', hint: 'g ,', run: run(() => actions.go('settings')) });
    if (score(q, 'refresh reload') >= 0) out.push({ id: 'refresh', group: 'Commands', label: 'Refresh everything', run: run(actions.refresh) });

    if (q.length > 2) {
      const ask: Item = { id: 'ask', group: 'Ask', label: `Ask the local model: “${query.trim()}”`, sub: 'sees your repos, sessions and PRs · no Claude tokens', hint: 'Ctrl+↵', run: run(() => actions.ask(query.trim())) };
      // A question goes first; otherwise it's the fallback at the end.
      if (/\?$|^(what|why|how|when|which|who|is|are|did|do|can|should)\b/i.test(query.trim())) out.unshift({ ...ask, group: 'Best match' });
      else out.push(ask);
    }
    return out;
  }, [q, query, data, actions, onClose]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && q.length > 2) items.find((i) => i.id === 'ask')?.run();
      else items[active]?.run();
    }
  };

  let lastGroup = '';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <span className="mono" style={{ color: 'var(--accent)', fontSize: 18 }}>
            &gt;
          </span>
          <input
            autoFocus
            aria-label="Search repos, sessions, PRs and actions"
            placeholder="Jump to a repo, session, PR… or ask a question"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <p className="muted pad">Nothing matches “{query}”.</p>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && <div className="palette-group eyebrow" style={{ color: 'var(--muted)' }}>{header}</div>}
                <button data-i={i} className={`palette-item ${i === active ? 'on' : ''}`} onMouseEnter={() => setActive(i)} onClick={it.run}>
                  {it.color ? <span className="led" style={{ background: it.color }} /> : <span className="mono" style={{ color: 'var(--info)' }}>›</span>}
                  <span className="grow">
                    <span style={{ display: 'block' }}>{it.label}</span>
                    {it.sub && <span className="sub">{it.sub}</span>}
                  </span>
                  {it.hint && <span className="kbd">{it.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> move
          </span>
          <span>
            <span className="kbd">↵</span> open
          </span>
          <span>
            <span className="kbd">Ctrl+↵</span> ask the local model
          </span>
          <span>
            <span className="kbd">g</span> then a letter jumps anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
