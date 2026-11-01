import { useEffect, useState } from 'react';
import type { EmailAccount, EmailProfile, MailCategory, TriageItem, TriageResult } from '@shared/types';
import type { Actions } from '../App';
import { ago } from '../util';

const PROVIDERS: { id: string; label: string; help: string; url?: string }[] = [
  { id: 'gmail', label: 'Gmail', help: 'Turn on 2-Step Verification for your Google account, then create an app password named "DevCockpit".', url: 'https://myaccount.google.com/apppasswords' },
  { id: 'yahoo', label: 'Yahoo Mail', help: 'Create an app password in Account security.', url: 'https://login.yahoo.com/myaccount/security/app-password' },
  { id: 'icloud', label: 'iCloud Mail', help: 'Create an app-specific password under Sign-In and Security.', url: 'https://account.apple.com/account/manage' },
  { id: 'fastmail', label: 'Fastmail', help: 'Create an app password with IMAP access.', url: 'https://app.fastmail.com/settings/security/apps' },
  { id: 'zoho', label: 'Zoho Mail', help: 'Enable IMAP, then create an app-specific password.' },
  { id: 'other', label: 'Other (IMAP)', help: 'Use your provider\'s IMAP server (port 993, SSL) and an app password if it offers one.' },
];

const SECTIONS: { cat: MailCategory; title: string; open: boolean }[] = [
  { cat: 'job', title: 'Job invites', open: true },
  { cat: 'reply', title: 'Needs your reply', open: true },
  { cat: 'fyi', title: 'FYI and notifications', open: false },
  { cat: 'spam', title: 'Likely spam', open: false },
];

export function Email({ actions }: { actions: Actions }) {
  const [status, setStatus] = useState<{ account: EmailAccount | null; connected: boolean; profile: EmailProfile; autoDraft: boolean } | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const reload = async () => {
    const s = await window.cockpit.emailStatus();
    setStatus(s);
    if (s.connected) setTriage(await window.cockpit.emailLastTriage());
    if (s.connected && !s.profile.name) setShowProfile(true);
  };

  useEffect(() => {
    reload();
  }, []);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setTriage(await window.cockpit.emailTriage());
    } catch (e) {
      setError(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setChecking(false);
    }
  };

  if (!status) return null;
  if (!status.connected) return <Connect onDone={reload} actions={actions} />;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Email</h1>
          <p className="muted">
            {status.account?.user} · sorted and drafted on your machine · drafts are saved to your Drafts folder and <strong>never sent</strong>
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setShowProfile((v) => !v)}>
            Your profile
          </button>
          <button className="btn primary" onClick={check} disabled={checking}>
            {checking ? 'Checking…' : 'Check inbox'}
          </button>
        </div>
      </header>

      {showProfile && (
        <Profile
          initial={status.profile}
          autoDraft={status.autoDraft}
          onSave={async (p, auto) => {
            await window.cockpit.emailSetProfile(p, auto);
            setShowProfile(false);
            reload();
          }}
          onDisconnect={async () => {
            await window.cockpit.emailDisconnect();
            reload();
          }}
        />
      )}

      {error && <div className="card warn-card">{error}</div>}
      {!triage && !checking && <p className="muted">Click "Check inbox" to sort the last 7 days of email.</p>}
      {triage && (
        <p className="muted small">
          Checked {ago(triage.checkedAt)} · {triage.items.length} emails · sorted by {triage.usedModel ?? 'rules (start Ollama for smarter sorting)'}
        </p>
      )}
      {triage &&
        SECTIONS.map((s) => {
          const items = triage.items.filter((i) => i.category === s.cat);
          return items.length ? <Section key={s.cat} title={s.title} items={items} defaultOpen={s.open} gmail={status.account?.provider === 'gmail'} actions={actions} /> : null;
        })}
    </div>
  );
}

function Section({ title, items, defaultOpen, gmail, actions }: { title: string; items: TriageItem[]; defaultOpen: boolean; gmail: boolean; actions: Actions }) {
  const [open, setOpen] = useState(defaultOpen);
  const pending = items.filter((i) => !i.answered && !i.draftSaved).length;
  return (
    <section className="card">
      <button className="group-head" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'}</span>
        <span className="grow">
          {title} ({items.length})
        </span>
        {pending > 0 && (title === 'Job invites' || title === 'Needs your reply') && <span className="chip warn">{pending} to answer</span>}
      </button>
      {open && (
        <ul className="list">
          {items.map((i) => (
            <MailRow key={i.uid} item={i} gmail={gmail} actions={actions} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MailRow({ item, gmail, actions }: { item: TriageItem; gmail: boolean; actions: Actions }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(item.draft ?? '');
  const [busy, setBusy] = useState<'draft' | 'save' | null>(null);
  const [saved, setSaved] = useState(item.draftSaved);
  const [error, setError] = useState<string | null>(null);
  const replyable = item.category === 'job' || item.category === 'reply';

  const run = async (kind: 'draft' | 'save') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'draft') setDraft(await window.cockpit.emailDraft(item.uid));
      else {
        await window.cockpit.emailSaveDraft(item.uid, draft);
        setSaved(true);
      }
    } catch (e) {
      setError(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="mail">
      <div className="list-row" onClick={() => setExpanded(!expanded)}>
        <div className="grow">
          <div className="title">
            <strong>{item.fromName || item.fromAddress}</strong> · {item.subject}
          </div>
          <div className="muted small">
            {ago(item.date)} · {item.reason}
          </div>
        </div>
        <div className="chips">
          {item.answered && <span className="chip ok">replied</span>}
          {!item.answered && saved && <span className="chip info">draft saved</span>}
        </div>
      </div>
      {expanded && (
        <div className="mail-body">
          <pre className="mail-text">{item.text || '(no text content)'}</pre>
          {replyable && !item.answered && (
            <div className="draft">
              {draft ? (
                <textarea className="input" rows={9} value={draft} onChange={(e) => (setDraft(e.target.value), setSaved(false))} />
              ) : (
                <p className="muted small">No draft yet.</p>
              )}
              <div className="row">
                <button className="btn" onClick={() => run('draft')} disabled={busy !== null}>
                  {busy === 'draft' ? 'Writing…' : draft ? 'Rewrite' : 'Write draft'}
                </button>
                {draft && (
                  <button className="btn primary" onClick={() => run('save')} disabled={busy !== null || saved}>
                    {busy === 'save' ? 'Saving…' : saved ? 'Saved to Drafts' : 'Save to Drafts'}
                  </button>
                )}
                {gmail && item.messageId && (
                  <button className="btn" onClick={() => actions.openExternal(`https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(item.messageId.replace(/[<>]/g, ''))}`)}>
                    Open in Gmail
                  </button>
                )}
              </div>
              {error && <p className="warn-text small">{error}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Connect({ onDone, actions }: { onDone: () => void; actions: Actions }) {
  const [provider, setProvider] = useState('gmail');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = PROVIDERS.find((x) => x.id === provider)!;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.cockpit.emailConnect({ provider, user, password, displayName, host: provider === 'other' ? host : undefined });
      setPassword('');
      onDone();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      setError(/auth|login|credentials|invalid/i.test(msg) ? `Login failed. Check the email address and app password (not your normal password). ${msg}` : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Connect your email</h1>
          <p className="muted">DevCockpit sorts your inbox and writes reply drafts on your machine. It can only read mail and save drafts: it has no way to send.</p>
        </div>
      </header>
      <section className="card">
        <label className="field">
          <span className="muted small">Provider</span>
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <p className="small">
          {p.help}{' '}
          {p.url && (
            <a onClick={() => actions.openExternal(p.url!)}>
              Open that page →
            </a>
          )}
        </p>
        <p className="muted small">Outlook and Hotmail aren't supported yet: Microsoft no longer allows app passwords for IMAP on personal accounts.</p>
        {provider === 'other' && (
          <label className="field">
            <span className="muted small">IMAP server</span>
            <input className="input" placeholder="imap.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span className="muted small">Email address</span>
          <input className="input" type="email" value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="field">
          <span className="muted small">App password (stored encrypted by your operating system)</span>
          <input className="input mono" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="field">
          <span className="muted small">Your name (shown on drafts)</span>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <button className="btn primary" onClick={connect} disabled={busy || !user || !password || (provider === 'other' && !host)}>
          {busy ? 'Connecting…' : 'Test and connect'}
        </button>
        {error && <p className="warn-text small">{error}</p>}
      </section>
    </div>
  );
}

function Profile({ initial, autoDraft, onSave, onDisconnect }: { initial: EmailProfile; autoDraft: boolean; onSave: (p: EmailProfile, auto: boolean) => void; onDisconnect: () => void }) {
  const [p, setP] = useState(initial);
  const [auto, setAuto] = useState(autoDraft);
  return (
    <section className="card">
      <h3>Your profile for drafts</h3>
      <p className="muted small">Drafts are written in your voice from this. Don't put your phone number here; drafts never include one.</p>
      <div className="form-grid">
        <label className="field">
          <span className="muted small">Name</span>
          <input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </label>
        <label className="field">
          <span className="muted small">Signature</span>
          <input className="input" placeholder="e.g. Best, Hari" value={p.signature} onChange={(e) => setP({ ...p, signature: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span className="muted small">About you and what you're looking for (role, stack, location/remote, notice period, what you'd decline)</span>
        <textarea className="input" rows={4} value={p.about} onChange={(e) => setP({ ...p, about: e.target.value })} />
      </label>
      <label className="check big">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> The email routine saves drafts to my Drafts folder automatically (they are never sent)
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={() => onSave(p, auto)}>
          Save profile
        </button>
        <span className="spacer" />
        <button className="btn" onClick={onDisconnect}>
          Disconnect email
        </button>
      </div>
    </section>
  );
}
