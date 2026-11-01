import { useMemo, useState } from 'react';
import type { Repo, Todo } from '@shared/types';
import type { Actions, Data } from '../App';
import { dayKey } from '../insights';
import { repoColor, samePath, tint } from '../util';

type Item = { repo: Repo; todo: Todo };

const DAY = 86400_000;

/** Which bucket a todo's date falls in. Undated todos (hand-written ones) go last. */
function bucket(addedAt: string | null): string {
  if (!addedAt) return 'No date';
  const today = dayKey(new Date());
  if (addedAt === today) return 'Today';
  if (addedAt === dayKey(new Date(Date.now() - DAY))) return 'Yesterday';
  if (addedAt >= dayKey(new Date(Date.now() - 6 * DAY))) return 'This week';
  return 'Older';
}
const BUCKETS = ['Today', 'Yesterday', 'This week', 'Older', 'No date'];

const age = (addedAt: string | null) => {
  if (!addedAt) return '';
  const days = Math.round((new Date(`${dayKey(new Date())}T12:00:00`).getTime() - new Date(`${addedAt}T12:00:00`).getTime()) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
};

/** Every open todo across your repos, newest first, with one click to pick it up. */
export function Todos({ data, actions, currentRepo }: { data: Data; actions: Actions; currentRepo: string }) {
  const repos = data.repos ?? [];
  const [filter, setFilter] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState(currentRepo);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const key = (i: Item) => `${i.repo.path}|${i.todo.file}|${i.todo.line}`;
  const items = useMemo(
    () =>
      repos
        .flatMap((repo) => repo.todos.map((todo) => ({ repo, todo })))
        .filter((i) => !done.has(key(i)))
        .sort((a, b) => (b.todo.addedAt ?? '').localeCompare(a.todo.addedAt ?? '')),
    [repos, done]
  );
  const shown = filter ? items.filter((i) => i.repo.path === filter) : items;
  const counts = repos.map((r) => ({ r, n: items.filter((i) => i.repo === r).length })).filter((c) => c.n);
  const lastSession = (r: Repo) => data.sessions?.find((s) => samePath(s.repoPath, r.path));

  const add = async () => {
    if (!text.trim() || !target) return;
    setError(null);
    try {
      await window.cockpit.addTodo(target, text);
      setText('');
      actions.refresh();
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  const complete = async (i: Item) => {
    setError(null);
    setDone((d) => new Set(d).add(key(i)));
    try {
      await window.cockpit.completeTodo(i.repo.path, i.todo);
    } catch (e) {
      setDone((d) => {
        const n = new Set(d);
        n.delete(key(i));
        return n;
      });
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  const pickUp = (i: Item) =>
    actions.openClaude(i.repo.path, {
      title: `todo · ${i.repo.name}`,
      prompt: `Let's pick up this todo from ${i.todo.file}: ${i.todo.text}. Look at the relevant code first, then tell me your plan.`,
    });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Todos</h1>
          <p className="muted">
            Unticked checklist items from each repo's TODO.md, ROADMAP.md and actions.md. In a Claude session opened here, say “add that to my
            todos” and it lands on this list.
          </p>
        </div>
      </header>

      <section className="panel" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <form
          className="row"
          style={{ flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <select className="input" style={{ width: 200, flexShrink: 0 }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Repo">
            {repos.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
          </select>
          <input className="input grow" placeholder="Add a todo, e.g. “Handle expired tokens in the refresh flow”" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn primary" disabled={!text.trim()}>
            Add
          </button>
        </form>
        {error && (
          <p className="small" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>
            {error}
          </p>
        )}
      </section>

      {counts.length > 1 && (
        <div className="row" style={{ marginBottom: 14 }}>
          <button className={`chip ${filter === null ? 'on' : ''}`} onClick={() => setFilter(null)}>
            All · {items.length}
          </button>
          {counts.map(({ r, n }) => (
            <button key={r.path} className={`chip ${filter === r.path ? 'on' : ''}`} style={{ color: repoColor(r.name) }} onClick={() => setFilter(filter === r.path ? null : r.path)}>
              {r.name} · {n}
            </button>
          ))}
        </div>
      )}

      {data.repos && !items.length && (
        <p className="muted">
          No open todos. Add one above, or ask Claude to “save that for later” in a session started from DevCockpit.
        </p>
      )}

      {BUCKETS.map((b) => {
        const list = shown.filter((i) => bucket(i.todo.addedAt) === b);
        if (!list.length) return null;
        return (
          <section key={b} style={{ marginBottom: 18 }}>
            <div className="label" style={{ marginBottom: 8, color: b === 'Yesterday' || b === 'Today' ? 'var(--accent)' : undefined }}>
              {b} · {list.length}
            </div>
            {list.map((i) => {
              const c = repoColor(i.repo.name);
              const last = lastSession(i.repo);
              return (
                <div key={key(i)} className="todo-row" style={{ borderLeftColor: c, background: tint(c, 0.03) }}>
                  <button className="todo-check" title="Mark done (ticks it off in the file)" aria-label={`Mark done: ${i.todo.text}`} onClick={() => complete(i)} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="todo-text">{i.todo.text}</div>
                    <div className="mono small muted">
                      <span style={{ color: c }}>{i.repo.name}</span>
                      {i.todo.file.toLowerCase() !== 'todo.md' && <> · {i.todo.file}</>}
                      {i.todo.addedAt && <> · {age(i.todo.addedAt)}</>} · {i.repo.branch}
                    </div>
                  </div>
                  {last && (
                    <button className="btn small" title={`Resume “${last.title}”`} onClick={() => actions.openClaude(i.repo.path, { resumeId: last.id, title: last.title })}>
                      Resume last
                    </button>
                  )}
                  <button className="btn small primary" title="Start Claude in this repo with this todo as the first message" onClick={() => pickUp(i)}>
                    Continue →
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
