import { Markdown } from './Markdown';

/** Streamed local-model output, rendered as markdown elements (never as HTML). */
export function AiOutput({ text, running, error }: { text: string; running: boolean; error: string | null }) {
  if (!text && !running && !error) return null;
  return (
    <div className="ai-output">
      {text && <Markdown text={text} />}
      {running && !text && <span className="muted">Thinking locally…</span>}
      {running && text && <span className="cursor" aria-hidden />}
      {error && <div className="warn-text">{error}</div>}
    </div>
  );
}
