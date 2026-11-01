// Minimal markdown renderer that builds React elements directly, so untrusted text
// (transcripts, model output) can never inject HTML. Supports headings, lists,
// quotes, fenced code, tables, **bold**, *italic*, `code` and https links.
import { Fragment, type ReactNode } from 'react';

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s\n][^*\n]*\*)|(_[^_\s\n][^_\n]*_)/g;

function openLink(url: string) {
  if (url.startsWith('https://')) void window.cockpit.openExternal(url);
}

function inline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    else if (m[3]) {
      const [, label, url] = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      out.push(
        url.startsWith('https://') ? (
          <a key={k} onClick={() => openLink(url)} title={url}>
            {label}
          </a>
        ) : (
          <span key={k}>{label}</span>
        )
      );
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;

interface ListItem {
  indent: number;
  ordered: boolean;
  start: number;
  text: string;
}

/** Renders items[from..to) as a list; deeper-indented runs become nested lists. */
function renderList(items: ListItem[], from: number, to: number, key: string): ReactNode {
  const base = items[from];
  const List = base.ordered ? 'ol' : 'ul';
  const children: ReactNode[] = [];
  let j = from;
  while (j < to) {
    const it = items[j];
    let end = j + 1;
    while (end < to && items[end].indent > it.indent) end++;
    children.push(
      <li key={j}>
        {inline(it.text, `${key}-${j}`)}
        {end > j + 1 && renderList(items, j + 1, end, `${key}-${j}n`)}
      </li>
    );
    j = end;
  }
  return (
    <List key={key} className="md-list" start={base.ordered && base.start !== 1 ? base.start : undefined}>
      {children}
    </List>
  );
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} className="md-code">{body.join('\n')}</pre>);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      blocks.push(
        <div key={k++} className={`md-h md-h${Math.min(h[1].length, 3)}`}>
          {inline(h[2], `h${k}`)}
        </div>
      );
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k++} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>{head.map((c, j) => <th key={j}>{inline(c, `th${k}${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${k}${ri}${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+)[.)]?\s+(.*)/)!;
        items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), start: Number(m[2]) || 1, text: m[3] });
        i++;
        // continuation lines belong to the previous item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !LIST_ITEM.test(lines[i])) items[items.length - 1].text += ` ${lines[i++].trim()}`;
      }
      blocks.push(renderList(items, 0, items.length, `l${k++}`));
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={k++} className="md-quote">{inline(body.join(' '), `q${k}`)}</blockquote>);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph: consecutive plain lines, keeping line breaks.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i]) && !(isTableRow(lines[i]) && isTableSep(lines[i + 1] ?? ''))) para.push(lines[i++]);
    blocks.push(
      <p key={k++} className="md-p">
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `p${k}${j}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div className="md">{blocks}</div>;
}
