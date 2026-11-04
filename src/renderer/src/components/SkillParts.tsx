import { useEffect, useState } from 'react';
import type { SkillFinding, SkillReview } from '@shared/types';
import { plural } from '../util';

// Pieces shared by the Skills tab and the skill finder.

export const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
export const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const SOURCE: Record<string, string> = { user: 'Personal skill', project: 'Repo skill', plugin: 'Plugin skill', online: 'Online skill' };

export function Findings({ findings, onPick }: { findings: SkillFinding[]; onPick: (file: string) => void }) {
  if (!findings.length)
    return (
      <p className="small" style={{ color: 'var(--ok)', margin: 0 }}>
        Nothing risky found. The scanner can't prove a skill is safe, so still skim it.
      </p>
    );
  const color = { danger: 'var(--danger)', warn: 'var(--warn)', info: 'var(--muted)' };
  return (
    <ul className="list" style={{ margin: 0 }}>
      {findings.map((f, i) => (
        <li key={i} className="list-row" onClick={() => onPick(f.file)} title="Show this file">
          <span className="mono small" style={{ color: color[f.level], width: 62, flexShrink: 0, textTransform: 'uppercase' }}>
            {f.level === 'danger' ? 'risk' : f.level === 'warn' ? 'check' : 'note'}
          </span>
          <span className="grow small">{f.message}</span>
          <span className="mono small muted">
            {f.file}
            {f.line ? `:${f.line}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Every file of the skill, shown as plain text: skill content is untrusted. */
export function Files({ review, file, onFile }: { review: SkillReview; file: string; onFile: (f: string) => void }) {
  const current = review.files.find((f) => f.path === file) ?? review.files[0];
  const lines = new Set(review.findings.filter((f) => f.file === current?.path && f.line).map((f) => f.line!));
  return (
    <section className="card">
      <h3>
        Files <span className="muted">· {plural(review.files.length, 'file')}, {kb(review.totalBytes)}</span>
      </h3>
      <div className="row" style={{ marginBottom: 10 }}>
        {review.files.map((f) => (
          <button key={f.path} className={`chip ${f.path === current?.path ? 'on' : ''}`} onClick={() => onFile(f.path)}>
            {f.path}
          </button>
        ))}
      </div>
      {current &&
        (current.text === null ? (
          <p className="muted small">Binary file ({kb(current.size)}). It can't be shown here.</p>
        ) : (
          <pre className="skill-file">
            {current.text.split(/\r?\n/).map((l, i) => (
              <div key={i} className={lines.has(i + 1) ? 'flagged' : undefined}>
                <span className="ln">{i + 1}</span>
                {l || ' '}
              </div>
            ))}
          </pre>
        ))}
    </section>
  );
}

export function useReview(load: () => Promise<SkillReview>, deps: unknown[]) {
  const [review, setReview] = useState<SkillReview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState('SKILL.md');
  useEffect(() => {
    setReview(null);
    setErr(null);
    load().then(setReview, (e) => setErr(errText(e)));
  }, deps);
  return { review, err, file, setFile };
}

export function Header({ title, review, sub }: { title: string; review: SkillReview | null; sub: string }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p className="muted small">
          {review ? `${SOURCE[review.sourceKind]} · ${review.sourceLabel}` : ''}
          {sub && <> · {sub}</>}
        </p>
        {review?.description && <p className="muted">{review.description}</p>}
      </div>
    </header>
  );
}
