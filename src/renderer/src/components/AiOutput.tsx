import { Markdown } from './Markdown';

/** Streamed local-model output, rendered as markdown elements (never as HTML). */
export function AiOutput({ text, running, error, context }: { text: string; running: boolean; error: string | null; context?: string[] | null }) {
  if (!text && !running && !error) return null;
  return (
    <div className="ai-output">
      {context && (
        <div className="chips ai-context">
          <span className="muted small">Using:</span>
          {context.map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
      )}
      {text && <Markdown text={text} />}
      {running && !text && <span className="muted">Thinking locally…</span>}
      {running && text && <span className="cursor" aria-hidden />}
      {error && <div className="warn-text">{error}</div>}
    </div>
  );
}
