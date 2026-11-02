import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { attach } from '../termBus';

export function TerminalView({ id, visible }: { id: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 13,
      allowProposedApi: false,
      theme: { background: '#0b0f14', foreground: '#d6dde6', cursor: '#f5a524', selectionBackground: '#2a3a4f' },
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(host.current!);
    const detach = attach(id, (d) => term.write(d));
    const input = term.onData((d) => window.cockpit.termWrite(id, d));
    const resize = term.onResize(({ cols, rows }) => window.cockpit.termResize(id, cols, rows));

    // Clipboard, Windows Terminal style: selecting copies; right-click copies a selection
    // or pastes; Ctrl+V pastes; Ctrl+C copies when there's a selection, else interrupts.
    const copy = () => {
      const text = term.getSelection();
      if (text) window.cockpit.clipboardWrite(text);
      return !!text;
    };
    const paste = () => window.cockpit.clipboardRead().then((text) => text && term.paste(text));
    const selection = term.onSelectionChange(copy);
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
      const key = e.key.toLowerCase();
      if (key === 'v') {
        e.preventDefault();
        paste();
        return false;
      }
      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        copy();
        term.clearSelection();
        return false;
      }
      return true;
    });
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) {
        copy();
        term.clearSelection();
      } else paste();
    };
    host.current!.addEventListener('contextmenu', onContextMenu);
    const ro = new ResizeObserver(() => {
      if (host.current?.offsetParent) fit.fit();
    });
    ro.observe(host.current!);
    requestAnimationFrame(() => fit.fit());
    return () => {
      ro.disconnect();
      host.current?.removeEventListener('contextmenu', onContextMenu);
      selection.dispose();
      input.dispose();
      resize.dispose();
      detach();
      term.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => fitRef.current?.fit());
  }, [visible]);

  return <div ref={host} className="term-host" style={{ display: visible ? 'block' : 'none' }} />;
}
