// Mailbox access over IMAP. IMAP can read mail and store drafts but has no way to
// send, and DevCockpit contains no SMTP code, so drafts are never sent.
// The app password is encrypted with the OS keychain (DPAPI / Keychain / libsecret).
import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { EmailAccount, MailMessage } from '@shared/types';

export const PROVIDERS: Record<string, { host: string; port: number; appPasswordUrl?: string }> = {
  gmail: { host: 'imap.gmail.com', port: 993, appPasswordUrl: 'https://myaccount.google.com/apppasswords' },
  yahoo: { host: 'imap.mail.yahoo.com', port: 993, appPasswordUrl: 'https://login.yahoo.com/myaccount/security/app-password' },
  icloud: { host: 'imap.mail.me.com', port: 993, appPasswordUrl: 'https://account.apple.com/account/manage' },
  fastmail: { host: 'imap.fastmail.com', port: 993, appPasswordUrl: 'https://app.fastmail.com/settings/security/apps' },
  zoho: { host: 'imap.zoho.com', port: 993 },
};

const secretFile = () => path.join(app.getPath('userData'), 'email-secret.bin');

export function savePassword(password: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("This system has no secure credential storage, so the password can't be saved safely.");
  fs.writeFileSync(secretFile(), safeStorage.encryptString(password));
}

function readPassword(): string | null {
  try {
    return safeStorage.decryptString(fs.readFileSync(secretFile()));
  } catch {
    return null;
  }
}

export function forgetPassword() {
  fs.rmSync(secretFile(), { force: true });
}

export const hasPassword = () => fs.existsSync(secretFile());

async function withClient<T>(account: EmailAccount, fn: (c: ImapFlow) => Promise<T>, password = readPassword()): Promise<T> {
  if (!password) throw new Error('No email password saved. Connect your mailbox in the Email tab.');
  // TLS only (port 993). Certificates are verified; there is no option to turn that off.
  const client = new ImapFlow({ host: account.host, port: account.port, secure: true, auth: { user: account.user, pass: password }, logger: false });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export async function testConnection(account: EmailAccount, password: string): Promise<string> {
  return withClient(
    account,
    async (c) => {
      const status = await c.status('INBOX', { messages: true });
      return `Connected. Inbox has ${status ? (status.messages ?? 0) : 0} messages.`;
    },
    password
  );
}

async function specialMailbox(c: ImapFlow, use: '\\Sent' | '\\Drafts'): Promise<string | null> {
  const boxes = await c.list();
  return boxes.find((b) => b.specialUse === use)?.path ?? null;
}

/** Has a message replying to `messageId` (sent, or already drafted) in this mailbox? */
async function hasReplyIn(c: ImapFlow, box: string | null, messageId: string): Promise<boolean> {
  if (!box || !messageId) return false;
  const lock = await c.getMailboxLock(box);
  try {
    const hits = await c.search({ header: { 'in-reply-to': messageId } }, { uid: true });
    return Array.isArray(hits) && hits.length > 0;
  } finally {
    lock.release();
  }
}

const BULK_SENDER = /(no-?reply|do-?not-?reply|notifications?|mailer-daemon|newsletter|updates?|marketing|digest)@/i;

/** Recent inbox messages, newest first, with reply/draft status. */
export async function fetchRecent(account: EmailAccount, days = 7, limit = 40): Promise<MailMessage[]> {
  return withClient(account, async (c) => {
    const since = new Date(Date.now() - days * 86400_000);
    const out: MailMessage[] = [];
    const lock = await c.getMailboxLock('INBOX');
    try {
      const uids = ((await c.search({ since }, { uid: true })) || []).slice(-limit).reverse();
      if (!uids.length) return [];
      for await (const msg of c.fetch(uids, { uid: true, flags: true, envelope: true, internalDate: true, source: { maxLength: 200_000 } }, { uid: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value[0];
        const headers = parsed.headers;
        out.push({
          uid: msg.uid,
          messageId: parsed.messageId ?? '',
          references: [parsed.references ?? []].flat().filter(Boolean) as string[],
          fromName: from?.name ?? '',
          fromAddress: from?.address ?? '',
          replyTo: parsed.replyTo?.value[0]?.address ?? null,
          subject: parsed.subject ?? '(no subject)',
          date: new Date(parsed.date ?? msg.internalDate ?? Date.now()).toISOString(),
          text: (parsed.text ?? '').replace(/\r/g, '').trim().slice(0, 6000),
          answered: msg.flags?.has('\\Answered') ?? false,
          bulk: headers.has('list-unsubscribe') || /bulk|list/i.test(String(headers.get('precedence') ?? '')) || BULK_SENDER.test(from?.address ?? ''),
          draftExists: false,
        });
      }
    } finally {
      lock.release();
    }
    out.sort((a, b) => b.date.localeCompare(a.date));

    // Not redundant: skip threads you've already replied to or already have a draft for.
    const [sent, drafts] = await Promise.all([specialMailbox(c, '\\Sent'), specialMailbox(c, '\\Drafts')]);
    for (const m of out) {
      if (m.bulk) continue;
      if (!m.answered) m.answered = await hasReplyIn(c, sent, m.messageId);
      m.draftExists = await hasReplyIn(c, drafts, m.messageId);
    }
    return out;
  });
}

/** Removes CR/LF so header values can't inject extra headers. */
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const angle = (id: string) => (id.startsWith('<') ? id : `<${id}>`);

export function buildReply(account: EmailAccount, original: MailMessage, body: string): string {
  const to = clean(original.replyTo || original.fromAddress);
  const subject = clean(/^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`);
  const refs = [...original.references, original.messageId].filter(Boolean).map((r) => angle(clean(r)));
  const fromName = clean(account.displayName || '');
  const quoted = original.text
    .split('\n')
    .slice(0, 40)
    .map((l) => `> ${l}`)
    .join('\n');
  const text = `${body.trim()}\n\nOn ${new Date(original.date).toUTCString()}, ${original.fromName || original.fromAddress} wrote:\n${quoted}\n`;
  const headers = [
    `From: ${fromName ? `${encodeHeader(fromName)} ` : ''}<${clean(account.user)}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@devcockpit.local>`,
    original.messageId ? `In-Reply-To: ${angle(clean(original.messageId))}` : '',
    refs.length ? `References: ${refs.join(' ')}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  const b64 = Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${b64}\r\n`;
}

/** Stores a reply in the Drafts folder, threaded under the original. Never sends. */
export async function saveDraft(account: EmailAccount, original: MailMessage, body: string): Promise<void> {
  await withClient(account, async (c) => {
    const drafts = await specialMailbox(c, '\\Drafts');
    if (!drafts) throw new Error('Could not find your Drafts folder.');
    await c.append(drafts, buildReply(account, original, body), ['\\Draft', '\\Seen']);
  });
}
