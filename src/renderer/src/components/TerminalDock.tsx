import { useEffect, useRef, useState } from 'react';
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

const MIN_HEIGHT = 160;
/** Space always left for the page above, so the dock can never cover the whole stage. */
const MIN_PAGE = 40;

export function TerminalDock({ tabs, active, open, height, onHeight, onSelect, onClose, onNew, onHide }: Props) {
  const dock = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const restore = useRef<number | null>(null);
  const [room, setRoom] = useState(window.innerHeight);

  // The dock's limit is the height of the area it lives in, re-measured whenever
  // the window (or anything around it) resizes. This keeps the tab bar on screen.
  useEffect(() => {
    const stage = dock.current?.parentElement;
    if (!stage) return;
    const measure = () => setRoom(stage.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  const max = Math.max(MIN_HEIGHT, room - MIN_PAGE);
  const shown = Math.min(Math.max(height, MIN_HEIGHT), max);
  const maximised = shown >= max - 1;

  const toggleMax = () => {
    if (maximised) onHeight(restore.current ?? Math.round(max * 0.45));
    else {
      restore.current = shown;
      onHeight(max);
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: shown };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    onHeight(Math.max(MIN_HEIGHT, Math.min(max, drag.current.h + (drag.current.y - e.clientY))));
  };

  return (
    <section ref={dock} className="dock" style={{ height: shown, display: open ? 'flex' : 'none' }}>
      <div className="dock-grip" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => (drag.current = null)} />
      <div className="dock-tabs" onDoubleClick={(e) => e.target === e.currentTarget && toggleMax()} title="Double-click to maximise or restore">
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
        <button className="icon-btn" aria-label="New Claude session" title="New Claude Code session in the current repo" onClick={onNew}>
          +
        </button>
        <div className="spacer" onDoubleClick={toggleMax} />
        <button className="icon-btn" aria-label={maximised ? 'Restore terminal size' : 'Maximise terminal'} title={maximised ? 'Restore' : 'Maximise'} onClick={toggleMax}>
          {maximised ? '▭' : '▢'}
        </button>
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
