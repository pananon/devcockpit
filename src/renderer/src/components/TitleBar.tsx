import { Icon } from './Icons';

/**
 * Replaces the native title bar. The whole bar drags the window (and double-click
 * maximises); only the search pill is clickable. The OS draws the window buttons
 * on the right, so that area is left empty.
 */
export function TitleBar({ section, onSearch }: { section: string; onSearch: () => void }) {
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <Icon.logo />
        <span className="titlebar-name">DevCockpit</span>
        <span className="titlebar-sep">//</span>
        <span className="titlebar-section">{section}</span>
      </div>
      <button className="titlebar-search" onClick={onSearch} aria-label="Search or jump (Ctrl+K)">
        <Icon.search />
        <span>Search or jump…</span>
        <span className="kbd">Ctrl+K</span>
      </button>
      <div className="titlebar-controls-space" aria-hidden="true" />
    </header>
  );
}
