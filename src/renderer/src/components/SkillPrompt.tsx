import { useEffect, useRef, useState } from 'react';
import type { SkillCandidate } from '@shared/types';
import { baseName } from '../util';

const POLL_MS = 30_000;
const DAY = 86400_000;

/**
 * "Claude just used a skill. Save it?" Checks the session index every 30 seconds
 * while the window is visible. A skill is offered once per new use: dismissing it
 * records the time, and it comes back only after Claude uses it again. On first
 * launch only uses from the last day are offered, so old history doesn't flood in.
 */
export function SkillPrompt({ enabled, onReview }: { enabled: boolean; onReview: (name: string) => void }) {
  const [cand, setCand] = useState<SkillCandidate | null>(null);
  const seen = useRef(new Set<string>());
  const since = useRef(new Date(Date.now() - DAY).toISOString());

  useEffect(() => {
    if (!enabled) {
      setCand(null);
      return;
    }
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const list = await window.cockpit.skillCandidates().catch(() => [] as SkillCandidate[]);
      const fresh = list.find((c) => !seen.current.has(`${c.name}@${c.lastUsedAt}`) && c.lastUsedAt > (c.promptedAt ?? since.current));
      if (fresh) setCand((cur) => cur ?? fresh);
    };
    check();
    const t = setInterval(check, POLL_MS);
    return () => clearInterval(t);
  }, [enabled]);

  if (!cand) return null;

  const close = (how: 'later' | 'never') => {
    seen.current.add(`${cand.name}@${cand.lastUsedAt}`);
    setCand(null);
    void window.cockpit.dismissSkill(cand.name, how);
  };

  return (
    <div className="skill-toast" role="dialog" aria-label="Save skill">
      <div className="label" style={{ color: 'var(--accent)' }}>
        {cand.changed ? 'Skill updated' : 'Skill used'}
        {cand.repos[0] ? ` · ${baseName(cand.repos[0])}` : ''}
      </div>
      <div style={{ marginTop: 6 }}>
        Claude used <span className="mono">{cand.name}</span>.{' '}
        {cand.changed ? 'It has changed since you saved it. Update your library copy?' : 'Save it to DevCockpit so you can use it in any repo?'}
      </div>
      {cand.description && <div className="muted small" style={{ marginTop: 4 }}>{cand.description.slice(0, 160)}</div>}
      <div className="row">
        <button
          className="btn small primary"
          onClick={() => {
            close('later');
            onReview(cand.name);
          }}
        >
          Review and save
        </button>
        <button className="btn small" onClick={() => close('later')}>
          Not now
        </button>
        <button className="btn small" onClick={() => close('never')} title="Never offer this skill again">
          Never
        </button>
      </div>
    </div>
  );
}
