import { useEffect, useState } from 'react';
import type { LibrarySkill, SkillCandidate, SkillSearch, SkillSearchMode } from '@shared/types';
import type { Actions, Data } from '../App';
import { errText, Files, Findings, Header, useReview } from '../components/SkillParts';
import { FinderPanel, OnlineDetail } from '../components/SkillFinder';
import { ago, baseName, plural } from '../util';

type Selection = { kind: 'candidate'; name: string } | { kind: 'library'; id: string } | { kind: 'finder' } | { kind: 'online'; id: string } | null;

/** The finder's state lives here, so results survive opening one of them. */
export interface FinderState {
  query: string;
  mode: SkillSearchMode;
  running: boolean;
  startedAt: number;
  result: SkillSearch | null;
  error: string | null;
}


/**
 * Skills Claude used in your sessions, and the library you've saved them to. Saving
 * and installing always go through a review here and a confirmation from the app.
 */
export function Skills({ data, actions, focus }: { data: Data; actions: Actions; focus?: string }) {
  const [cands, setCands] = useState<SkillCandidate[] | null>(null);
  const [library, setLibrary] = useState<LibrarySkill[] | null>(null);
  const [sel, setSel] = useState<Selection>(focus ? { kind: 'candidate', name: focus } : null);
  const [error, setError] = useState<string | null>(null);
  const [finder, setFinder] = useState<FinderState>({ query: '', mode: 'claude', running: false, startedAt: 0, result: null, error: null });

  const search = async () => {
    const query = finder.query.trim();
    if (query.length < 3 || finder.running) return;
    setFinder((f) => ({ ...f, running: true, startedAt: Date.now(), error: null, result: null }));
    try {
      const result = await window.cockpit.searchSkills(query, finder.mode);
      setFinder((f) => ({ ...f, running: false, result }));
    } catch (e) {
      setFinder((f) => ({ ...f, running: false, error: errText(e) }));
    }
  };

  const load = async () => {
    const [c, l] = await Promise.all([window.cockpit.skillCandidates().catch(() => []), window.cockpit.listLibrary().catch(() => [])]);
    setCands(c);
    setLibrary(l);
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (focus) setSel({ kind: 'candidate', name: focus });
  }, [focus]);

  const saved = async (s: LibrarySkill) => {
    await load();
    setSel({ kind: 'library', id: s.id });
  };

  return (
    <div className="split">
      <aside className="split-list">
        <div className="toolbar">
          <button className={`btn ${sel?.kind === 'finder' || sel?.kind === 'online' ? 'primary' : ''}`} style={{ width: '100%' }} onClick={() => setSel({ kind: 'finder' })}>
            Find skills online{finder.running ? ' · searching…' : ''}
          </button>
        </div>
        <div className="toolbar">
          <div className="label">Used by Claude · not saved</div>
        </div>
        {cands === null && <p className="muted pad">Looking through your sessions…</p>}
        {cands?.length === 0 && <p className="muted pad small">Nothing new. When Claude uses a skill in any session, it shows up here.</p>}
        <ul className="list">
          {cands?.map((c) => (
            <li key={c.name} className={`list-row ${sel?.kind === 'candidate' && sel.name === c.name ? 'selected' : ''}`} onClick={() => setSel({ kind: 'candidate', name: c.name })}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title">
                  {c.name} {c.changed && <span className="chip warn">updated</span>}
                </div>
                <div className="muted small">
                  {plural(c.uses, 'use')} · {c.repos.length ? c.repos.map(baseName).join(', ') : 'no repo'} · {ago(c.lastUsedAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="toolbar">
          <div className="label">Your library · {library?.length ?? 0}</div>
        </div>
        {library?.length === 0 && <p className="muted pad small">Saved skills appear here, ready to install in any repo.</p>}
        <ul className="list">
          {library?.map((l) => (
            <li key={l.id} className={`list-row ${sel?.kind === 'library' && sel.id === l.id ? 'selected' : ''}`} onClick={() => setSel({ kind: 'library', id: l.id })}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title">
                  {l.name} {l.tampered && <span className="chip warn">changed on disk</span>}
                </div>
                <div className="muted small">
                  {l.userInstall === 'same' ? 'In every repo' : l.repoInstalls.length ? `In ${plural(l.repoInstalls.length, 'repo')}` : 'Not installed'} · saved {ago(l.savedAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </aside>
      <section className="split-detail">
        {error && (
          <p className="pad small" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        {sel?.kind === 'candidate' && (
          <CandidateDetail
            key={sel.name}
            name={sel.name}
            candidate={cands?.find((c) => c.name === sel.name)}
            onSaved={saved}
            onDismissed={async () => {
              setSel(null);
              await load();
            }}
            onError={setError}
          />
        )}
        {sel?.kind === 'library' && library?.find((l) => l.id === sel.id) && (
          <LibraryDetail
            key={sel.id}
            skill={library.find((l) => l.id === sel.id)!}
            data={data}
            onChange={load}
            onRemoved={async () => {
              setSel(null);
              await load();
            }}
            onError={setError}
            actions={actions}
          />
        )}
        {sel?.kind === 'finder' && <FinderPanel state={finder} setState={setFinder} onSearch={search} onOpen={(id) => setSel({ kind: 'online', id })} />}
        {sel?.kind === 'online' && finder.result?.results.find((r) => r.id === sel.id) && (
          <OnlineDetail key={sel.id} result={finder.result.results.find((r) => r.id === sel.id)!} onBack={() => setSel({ kind: 'finder' })} onSaved={saved} onError={setError} />
        )}
        {!sel && <Intro />}
      </section>
    </div>
  );
}

function Intro() {
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Skills</h1>
          <p className="muted">
            Keep the skills you rely on, like building a website or making a product video, and use them in any repo. DevCockpit notices when
            Claude uses a skill in a session and offers to save it.
          </p>
        </div>
      </header>
      <section className="card">
        <h3>How it works</h3>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Claude uses a skill in any session (in the built-in terminal or your own).</li>
          <li>DevCockpit asks whether to save it. You read every file first.</li>
          <li>Install it for every repo (in ~/.claude/skills), or into one repo's .claude/skills to share it with your team.</li>
        </ol>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Looking for something new? <b>Find skills online</b> asks Claude to search GitHub for you, then checks every result itself.
        </p>
      </section>
      <section className="card">
        <h3>Why there's a review step</h3>
        <p className="muted small" style={{ margin: 0 }}>
          A skill is instructions Claude follows, and it can include scripts Claude runs. A bad one can tell Claude to leak keys or run
          downloaded code, and installing it in a repo passes that on to everyone who clones it. So nothing is saved or installed without
          your OK, secrets block repo installs, and DevCockpit flags risky lines for you to read. The scanner helps, but only you can decide
          whether you trust a skill.
        </p>
      </section>
    </div>
  );
}

function CandidateDetail({
  name,
  candidate,
  onSaved,
  onDismissed,
  onError,
}: {
  name: string;
  candidate?: SkillCandidate;
  onSaved: (s: LibrarySkill) => void;
  onDismissed: () => void;
  onError: (e: string | null) => void;
}) {
  const { review, err, file, setFile } = useReview(() => window.cockpit.reviewSkill(name), [name]);
  const [busy, setBusy] = useState(false);
  const danger = review?.findings.filter((f) => f.level === 'danger').length ?? 0;

  const save = async () => {
    if (!review) return;
    onError(null);
    setBusy(true);
    try {
      const s = await window.cockpit.saveSkill(name, review.hash);
      if (s) onSaved(s);
    } catch (e) {
      onError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async (how: 'later' | 'never') => {
    await window.cockpit.dismissSkill(name, how);
    onDismissed();
  };

  return (
    <div className="page">
      <Header title={name} review={review} sub={candidate ? `${plural(candidate.uses, 'use')}, last ${ago(candidate.lastUsedAt)}` : ''} />
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      {!review && !err && <p className="muted">Reading the skill…</p>}
      {review && (
        <>
          {candidate?.changed && (
            <section className="card warn-card">
              <p className="small" style={{ margin: 0 }}>
                This skill changed since you saved it. Saving again replaces the library copy with this version.
              </p>
            </section>
          )}
          <section className="card">
            <h3>Review</h3>
            <Findings findings={review.findings} onPick={setFile} />
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" disabled={busy} onClick={save}>
                {danger ? 'Save anyway…' : 'Save to library…'}
              </button>
              <button className="btn" onClick={() => dismiss('later')} title="Ask again the next time Claude uses it">
                Not now
              </button>
              <button className="btn" onClick={() => dismiss('never')}>
                Never offer this skill
              </button>
            </div>
          </section>
          <Files review={review} file={file} onFile={setFile} />
        </>
      )}
    </div>
  );
}

function LibraryDetail({
  skill,
  data,
  actions,
  onChange,
  onRemoved,
  onError,
}: {
  skill: LibrarySkill;
  data: Data;
  actions: Actions;
  onChange: () => void;
  onRemoved: () => void;
  onError: (e: string | null) => void;
}) {
  const { review, err, file, setFile } = useReview(() => window.cockpit.librarySkillFiles(skill.id), [skill.id, skill.hash]);
  const repos = data.repos ?? [];
  const [repo, setRepo] = useState(repos[0]?.path ?? '');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    onError(null);
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (e) {
      onError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const installedIn = (p: string) => skill.repoInstalls.some((r) => r === p);

  return (
    <div className="page">
      <Header title={skill.name} review={review} sub={`saved ${ago(skill.savedAt)}`} />
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      {skill.tampered && (
        <section className="card warn-card">
          <p className="small" style={{ margin: 0 }}>
            The library copy no longer matches what you saved, so installing is blocked. Something changed the files on disk. Remove it and save it
            again from a session.
          </p>
        </section>
      )}
      <section className="card">
        <h3>Use it</h3>
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="btn primary" disabled={busy || skill.tampered} onClick={() => run(() => window.cockpit.installSkill(skill.id, 'user'))}>
            {skill.userInstall === 'same' ? 'Installed for every repo ✓' : skill.userInstall === 'different' ? 'Update for every repo…' : 'Install for every repo…'}
          </button>
          <span className="muted small">Copies it to ~/.claude/skills. Only you get it.</span>
        </div>
        <div className="row" style={{ alignItems: 'center', marginTop: 10, flexWrap: 'nowrap' }}>
          <select className="input" style={{ width: 220 }} value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repo">
            {repos.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
                {installedIn(r.path) ? ' ✓' : ''}
              </option>
            ))}
          </select>
          <button className="btn" disabled={busy || skill.tampered || !repo} onClick={() => run(() => window.cockpit.installSkill(skill.id, { repoPath: repo }))}>
            {installedIn(repo) ? 'Installed ✓' : 'Install in this repo…'}
          </button>
          <span className="muted small">Copies it to .claude/skills. Commit it to share with your team.</span>
        </div>
        {skill.repoInstalls.length > 0 && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            In: {skill.repoInstalls.map(baseName).join(', ')}.{' '}
            <button className="btn small" onClick={() => actions.openClaude(skill.repoInstalls[0], { prompt: `Use the ${skill.id} skill.` })}>
              Try it in {baseName(skill.repoInstalls[0])}
            </button>
          </p>
        )}
      </section>
      {skill.url && (
        <p className="muted small">
          Downloaded from{' '}
          <button className="btn small" onClick={() => actions.openExternal(skill.url!)}>
            GitHub ↗
          </button>{' '}
          at a pinned commit. Updates to that repo don't change your copy.
        </p>
      )}
      <section className="card">
        <h3>Review</h3>
        <Findings findings={skill.findings} onPick={setFile} />
      </section>
      {review && <Files review={review} file={file} onFile={setFile} />}
      <div className="row">
        <button className="btn danger" disabled={busy} onClick={() => run(async () => (await window.cockpit.removeLibrarySkill(skill.id)) && onRemoved())}>
          Remove from library…
        </button>
      </div>
    </div>
  );
}
