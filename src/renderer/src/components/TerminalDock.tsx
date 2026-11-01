import { useRef } from 'react';
import { TerminalView } from './TerminalView';

export interface TermTab {
  id: string;
  title: string;
  exited?: boolean;
}

interface Props {
  tabs: TermTab[];
  active: string | null;
  /** hidden docks stay mounted so terminal scrollback survives */
  open: boolean;
  height: number;
  onHeight: (h: number) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onHide: () => void;
}

export function TerminalDock({ tabs, active, open, height, onHeight, onSelect, onClose, onNew, onHide }: Props) {
  const drag = useRef<{ y: number; h: number } | null>(null);

  const startDrag = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: height };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const h = drag.current.h + (drag.current.y - e.clientY);
    onHeight(Math.max(160, Math.min(window.innerHeight - 160, h)));
  };

  return (
    <section className="dock" style={{ height, display: open ? 'flex' : 'none' }}>
      <div className="dock-grip" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => (drag.current = null)} />
      <div className="dock-tabs">
        {tabs.map((t) => (
          <div key={t.id} className={`dock-tab ${t.id === active ? 'active' : ''} ${t.exited ? 'exited' : ''}`} onClick={() => onSelect(t.id)}>
            <span className="dock-tab-title">{t.title}</span>
            <button
              className="icon-btn"
              aria-label={`Close ${t.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="icon-btn" aria-label="New Claude session" title="New Claude Code session" onClick={onNew}>
          +
        </button>
        <div className="spacer" />
        <button className="icon-btn" aria-label="Hide terminal" title="Hide (Ctrl+`)" onClick={onHide}>
          ▾
        </button>
      </div>
      <div className="dock-body">
        {tabs.map((t) => (
          <TerminalView key={t.id} id={t.id} visible={open && t.id === active} />
        ))}
      </div>
    </section>
  );
}
