// Inline stroke icons (no icon font or remote assets).
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true } as const;

export const Icon = {
  today: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  ),
  workspace: () => (
    <svg {...base}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 7v10M18 11c0 4-6 3-12 6" />
    </svg>
  ),
  sessions: () => (
    <svg {...base}>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  ),
  prs: () => (
    <svg {...base}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 8v8M18 16V9a3 3 0 0 0-3-3h-4" />
      <path d="M13 3l-2 3 2 3" />
    </svg>
  ),
  flow: () => (
    <svg {...base}>
      <rect x="3" y="4" width="5" height="16" />
      <rect x="10" y="4" width="5" height="10" />
      <rect x="17" y="4" width="4" height="6" />
    </svg>
  ),
  todos: () => (
    <svg {...base}>
      <rect x="4" y="5" width="4" height="4" />
      <path d="M11 7h9M11 17h9" />
      <rect x="4" y="15" width="4" height="4" />
      <path d="m4.5 16.5 1.5 1.5 2.5-3" />
    </svg>
  ),
  skills: () => (
    <svg {...base}>
      <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z" />
    </svg>
  ),
  insights: () => (
    <svg {...base}>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V6M17 16v-8" />
    </svg>
  ),
  routines: () => (
    <svg {...base}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2h6" />
    </svg>
  ),
  ai: () => (
    <svg {...base}>
      <rect x="6" y="6" width="12" height="12" />
      <rect x="9.5" y="9.5" width="5" height="5" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </svg>
  ),
  settings: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  ),
  focus: () => (
    <svg {...base}>
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  search: () => (
    <svg {...base}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  ),
  terminal: () => (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M7 9l3 3-3 3M12 15h5" />
    </svg>
  ),
  logo: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 18 L11 5 V18 Z M13 5 L21 18 H13 Z" fill="#f5a524" />
    </svg>
  ),
};
