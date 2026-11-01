/** Streamed local-model output. Plain text only: model output is never rendered as HTML. */
export function AiOutput({ text, running, error }: { text: string; running: boolean; error: string | null }) {
  if (!text && !running && !error) return null;
  return (
    <div className="ai-output">
      {text && <div className="msg-text">{text}</div>}
      {running && !text && <span className="muted">Thinking locally…</span>}
      {running && text && <span className="cursor" aria-hidden />}
      {error && <div className="warn-text">{error}</div>}
    </div>
  );
}
