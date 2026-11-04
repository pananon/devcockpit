// Demo mode (`--demo`): every backend call answers with made-up but realistic data,
// so screenshots and recordings never show real repos, sessions, paths or names.
// Nothing here reads the disk, runs git/gh/claude, or opens a network connection.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  AiTask,
  Brief,
  ModelReport,
  OllamaStatus,
  PrBuckets,
  PullRequest,
  Repo,
  Routine,
  RoutineInput,
  RoutineRun,
  LibrarySkill,
  SessionSummary,
  Settings,
  SkillCandidate,
  SkillReview,
  SkillSearchResult,
  SystemInfo,
  SystemUsage,
  TerminalSpec,
  TranscriptItem,
} from '@shared/types';
import { clipboard } from 'electron';
import { cleanPlanPrice } from './config';
import { buildReport } from './models';
import { nextRun } from './routines';
import { dayKey } from './sessions';

type Send = (channel: string, ...args: unknown[]) => void;

const ROOT = process.platform === 'win32' ? 'C:\\code' : '/home/dev/code';
const OWNER = 'orbitworks';
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
const repoPath = (name: string) => path.join(ROOT, name);
const hash = () => randomUUID().replace(/-/g, '').slice(0, 7);

const commits = (list: [string, number][]) => list.map(([subject, h]) => ({ hash: hash(), subject, date: at(h) }));

function repo(name: string, r: Partial<Repo> & { log: [string, number][] }): Repo {
  const recentCommits = commits(r.log);
  return {
    path: repoPath(name),
    name,
    branch: 'main',
    remoteUrl: `https://github.com/${OWNER}/${name}.git`,
    github: `${OWNER}/${name}`,
    uncommitted: [],
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    todos: [],
    ...r,
    lastCommit: recentCommits[0] ?? null,
    recentCommits,
  };
}

let todoLine = 2;
/** A todo as Claude (or the Todos tab) writes it: "- [ ] text <!-- date -->". */
const todo = (text: string, daysAgo: number | null, file = 'TODO.md'): Repo['todos'][number] => ({
  file,
  text,
  line: todoLine++,
  addedAt: daysAgo == null ? null : dayKey(at(daysAgo * 24)),
});

const REPOS: Repo[] = [
  repo('orbit-api', {
    branch: 'feat/rate-limits',
    uncommitted: [' M src/middleware/rateLimit.ts', ' M src/routes/public.ts', '?? tests/rateLimit.test.ts', ' M package.json'],
    todos: [
      todo('Swap the in-memory rate-limit store for Redis before production (src/middleware/rateLimit.ts)', 0),
      todo('Document the 429 response and Retry-After header in the API reference', 1),
      todo('Load-test /v1/search at 200 req/s; it timed out once at 150', 1),
      todo('Remove the legacy v0 error format once the mobile app ships 2.4', 12),
    ],
    log: [
      ['Add sliding-window limiter skeleton', 3],
      ['Return problem+json errors from all routes', 26],
      ['Bump express to 5.2', 50],
    ],
  }),
  repo('orbit-web', {
    ahead: 2,
    todos: [
      todo('Pricing page: show the annual saving as a percentage, not just "2 months free"', 1),
      todo('Dark mode for the marketing pages', null, 'ROADMAP.md'),
    ],
    log: [
      ['Pricing page: annual toggle', 5],
      ['Fix layout shift on the hero image', 7],
      ['Fix hydration warning on dashboard', 30],
    ],
  }),
  repo('pocket-ledger', {
    branch: 'fix/sync-conflicts',
    uncommitted: [' M app/sync/merge.ts', ' M app/sync/queue.ts'],
    todos: [
      todo('Write a test for two phones editing the same expense offline, then finish the "Review changes" sheet', 1),
      todo('Ask design for the conflict badge icon', 4),
    ],
    ahead: 1,
    log: [
      ['Keep both edits when offline changes collide', 20],
      ['Retry sync with backoff', 44],
    ],
  }),
  repo('devnotes', {
    todos: [todo('Tag search: support "-#tag" to exclude a tag', 2)],
    log: [
      ['Search notes by tag', 28],
      ['Export a note as Markdown', 52],
      ['Faster startup: lazy-load the index', 70],
    ],
  }),
  repo('infra', {
    uncommitted: [' M staging/main.tf', '?? staging/alerts.tf'],
    log: [
      ['Move staging to the new region', 216],
      ['Nightly database backups', 260],
    ],
  }),
  repo('pixel-garden', {
    remoteUrl: null,
    github: null,
    hasUpstream: false,
    branch: 'feat/seasons',
    todos: [todo('Snow should settle on roofs, not float above them (src/world/weather.ts)', 19)],
    uncommitted: [' M src/world/weather.ts', ' M src/world/seasons.ts', '?? assets/snow.png', ' M src/main.ts', ' M README.md'],
    log: [['Seasons and weather', 480]],
  }),
];

interface DemoSession extends SessionSummary {
  transcript: TranscriptItem[];
}

function session(repoName: string, s: { title: string; prompts: string[]; reply: string; tools: [string, string][]; hoursAgo: number; minutes: number; branch?: string; cost: number }): DemoSession {
  const cwd = repoPath(repoName);
  const start = s.hoursAgo + s.minutes / 60;
  const transcript: TranscriptItem[] = [];
  s.prompts.forEach((p, i) => {
    const t = at(start - ((s.minutes / 60) * i) / s.prompts.length);
    transcript.push({ kind: 'user', text: p, at: t });
    if (i === 0) for (const [name, detail] of s.tools) transcript.push({ kind: 'tool', name, detail, at: t });
    transcript.push({ kind: 'assistant', text: i === s.prompts.length - 1 ? s.reply : 'Done. Want me to keep going?', at: t });
  });
  return {
    id: randomUUID(),
    file: '',
    title: s.title,
    firstPrompt: s.prompts[0],
    lastPrompt: s.prompts[s.prompts.length - 1],
    cwd,
    repoPath: cwd,
    gitBranch: s.branch ?? 'main',
    startedAt: at(start),
    updatedAt: at(s.hoursAgo),
    userTurns: s.prompts.length,
    costUSD: s.cost,
    promptDays: { [dayKey(at(s.hoursAgo))]: s.prompts.length },
    costDays: { [dayKey(at(s.hoursAgo))]: s.cost },
    transcript,
  };
}

const SESSIONS: DemoSession[] = [
  session('orbit-api', {
    title: 'Per-key rate limits for the public API',
    prompts: ['Add a per-key rate limit to the public API: 100 requests a minute, with tests.', 'Use a sliding window, not a fixed one.', 'Return a Retry-After header on 429s.'],
    tools: [
      ['Read', 'src/middleware/auth.ts'],
      ['Read', 'src/routes/public.ts'],
      ['Write', 'src/middleware/rateLimit.ts'],
      ['Bash', 'npm test -- rateLimit'],
    ],
    reply: 'Added a sliding-window limiter keyed by API key, mounted on every `/v1` route. 429 responses now carry `Retry-After`. **6 new tests pass.** The store is in-memory for now; production needs Redis (I added a TODO).',
    hoursAgo: 0.4,
    minutes: 42,
    branch: 'feat/rate-limits',
    cost: 1.84,
  }),
  session('orbit-web', {
    title: 'Annual billing toggle on the pricing page',
    prompts: ['Add a monthly/annual toggle to the pricing page. Annual is 2 months free.', 'Make the toggle keyboard accessible.'],
    tools: [
      ['Read', 'app/pricing/page.tsx'],
      ['Edit', 'app/pricing/page.tsx'],
      ['Bash', 'npm run lint'],
    ],
    reply: 'The toggle is a proper radio group now: arrow keys switch plans and screen readers announce the price change. Lint and type-check are clean.',
    hoursAgo: 5,
    minutes: 25,
    cost: 0.92,
  }),
  session('pocket-ledger', {
    title: 'Offline sync conflicts lose edits',
    prompts: ['When two phones edit the same expense offline, one edit disappears after sync. Find out why.', 'Keep both and let the user pick.'],
    tools: [
      ['Grep', 'lastWriteWins'],
      ['Read', 'app/sync/merge.ts'],
      ['Edit', 'app/sync/merge.ts'],
    ],
    reply: 'The merge used last-write-wins on the whole record. It now merges field by field and flags true conflicts, which show up in a "Review changes" sheet. Two files still uncommitted.',
    hoursAgo: 20,
    minutes: 55,
    branch: 'fix/sync-conflicts',
    cost: 2.31,
  }),
  session('devnotes', {
    title: 'Tag search',
    prompts: ['Let me search notes by tag, like `devnotes find #idea`.'],
    tools: [
      ['Read', 'src/index.ts'],
      ['Edit', 'src/search.ts'],
      ['Bash', 'npm test'],
    ],
    reply: '`devnotes find #idea` works, and tags combine: `#idea #api` finds notes with both. Pushed to main.',
    hoursAgo: 28,
    minutes: 18,
    cost: 0.47,
  }),
  session('orbit-api', {
    title: 'Consistent error responses',
    prompts: ['Every route returns errors in a different shape. Standardise on problem+json.'],
    tools: [
      ['Grep', 'res.status\\(4'],
      ['Write', 'src/errors.ts'],
    ],
    reply: 'All 23 routes now return RFC 9457 problem+json through one `sendProblem()` helper.',
    hoursAgo: 26,
    minutes: 35,
    cost: 1.12,
  }),
  session('infra', {
    title: 'Move staging to the new region',
    prompts: ['Plan moving staging to eu-central with no downtime.'],
    tools: [['Read', 'staging/main.tf']],
    reply: 'Plan applied. Staging is in the new region; the old one is drained and can be destroyed next week.',
    hoursAgo: 216,
    minutes: 60,
    cost: 1.65,
  }),
];

/** Earlier sessions, so Insights has two weeks (and more) of history to chart. */
const HISTORY: [daysAgo: number, repo: string, title: string, prompts: number, cost: number][] = [
  [0, 'orbit-api', 'Rate limit headers on every response', 19, 5.12],
  [2, 'orbit-api', 'Load test the public API', 21, 6.3],
  [2, 'pocket-ledger', 'Sync queue retries', 6, 1.4],
  [3, 'pocket-ledger', 'Reproduce the lost-edit bug', 18, 5.4],
  [4, 'devnotes', 'Fix the index rebuild on Windows', 2, 0.31],
  [10, 'orbit-api', 'Problem+json error format design', 38, 21.4],
  [10, 'orbit-web', 'Dashboard hydration warning', 12, 2.95],
  [11, 'orbit-web', 'Copy tweaks on the landing page', 3, 0.4],
  [12, 'orbit-api', 'Tenant lookup caching', 14, 3.2],
  [13, 'orbit-web', 'Pricing page redesign', 22, 11.6],
  [13, 'pocket-ledger', 'Offline mode spike', 9, 2.2],
  [13, 'devnotes', 'Tag parser', 6, 0.9],
  [20, 'pixel-garden', 'Seasons and weather system', 31, 12.4],
  [25, 'orbit-api', 'Move to Express 5', 44, 18.75],
  [33, 'orbit-web', 'Next.js upgrade', 27, 9.6],
  [41, 'pocket-ledger', 'Expense categories', 35, 14.1],
];

for (const [daysAgo, repoName, title, prompts, cost] of HISTORY) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(14, 0, 0, 0);
  const hoursAgo = Math.max(2, (Date.now() - d.getTime()) / 3600_000);
  const s = session(repoName, {
    title,
    prompts: [title, ...Array.from({ length: prompts - 1 }, () => 'Keep going.')],
    tools: [],
    reply: 'Done.',
    hoursAgo,
    minutes: prompts * 3,
    cost,
  });
  SESSIONS.push(s);
}
SESSIONS.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const pr = (name: string, number: number, title: string, author: string, hoursAgo: number, extra: Partial<PullRequest> = {}): PullRequest => ({
  repo: `${OWNER}/${name}`,
  number,
  title,
  url: `https://github.com/${OWNER}/${name}/pull/${number}`,
  author,
  isDraft: false,
  updatedAt: at(hoursAgo),
  state: 'OPEN',
  ...extra,
});

const ME = 'you';
const PRS: PrBuckets = {
  mine: [pr('orbit-api', 142, 'Per-key rate limits for the public API', ME, 1), pr('pocket-ledger', 57, 'Keep both edits on offline sync conflicts', ME, 19, { isDraft: true })],
  reviewRequested: [pr('orbit-web', 318, 'Move the pricing page to server components', 'maya-k', 2), pr('orbit-api', 139, 'Cache tenant lookups', 'devon-r', 9)],
  recentlyMerged: [pr('orbit-web', 315, 'Fix hydration warning on dashboard', ME, 30, { state: 'MERGED' }), pr('devnotes', 12, 'Search notes by tag', ME, 27, { state: 'MERGED' })],
  error: null,
};

const BRIEF: Brief = {
  recent: [
    { repo: 'orbit-api', titles: ['Per-key rate limits for the public API', 'Consistent error responses'] },
    { repo: 'orbit-web', titles: ['Annual billing toggle on the pricing page'] },
    { repo: 'pocket-ledger', titles: ['Offline sync conflicts lose edits'] },
  ],
  focus: [
    { action: "Review Maya's server-components PR before it goes stale", ref: { kind: 'pr', id: PRS.reviewRequested[0].url, label: 'orbit-web #318' }, fact: 'Review requested 2 hours ago.' },
    { action: 'Finish and commit the rate limiter, then mark PR #142 ready', ref: { kind: 'repo', id: repoPath('orbit-api'), label: 'orbit-api' }, fact: '4 uncommitted files on feat/rate-limits.' },
    { action: 'Push the two pricing-page commits', ref: { kind: 'repo', id: repoPath('orbit-web'), label: 'orbit-web' }, fact: '2 commits ahead of origin/main.' },
  ],
  model: 'qwen3.5:9b',
  usedModel: true,
};

const SYSTEM: SystemInfo = {
  platform: process.platform,
  arch: 'x64',
  cpu: 'AMD Ryzen 7 7700',
  cores: 16,
  ramGB: 32,
  gpus: [{ name: 'NVIDIA GeForce RTX 4070', vendor: 'nvidia', vramGB: 12, dedicated: true }],
  bestGpu: { name: 'NVIDIA GeForce RTX 4070', vendor: 'nvidia', vramGB: 12, dedicated: true },
  freeDiskGB: 412,
};

const ANSWER = `**Pick up orbit-api first.** The rate limiter is nearly done: 4 files are uncommitted on \`feat/rate-limits\` and PR #142 is waiting on them.

After that:
1. Review **orbit-web #318** from maya-k (requested 2 hours ago).
2. Push the 2 unpushed commits on **orbit-web**.
3. **pocket-ledger** has a draft PR for the sync fix; it needs the last two files committed.`;

const SUMMARY = `**What happened:** added a sliding-window rate limiter (100 requests a minute per API key) to every \`/v1\` route, with \`Retry-After\` on 429s.

**State:** 6 new tests pass. 4 files are uncommitted on \`feat/rate-limits\`.

**Next:** swap the in-memory store for Redis before production.`;

function demoRoutines(): Routine[] {
  const make = (name: string, schedule: Routine['schedule'], action: Routine['action'], lastHoursAgo: number | null, enabled = true): Routine => ({
    id: randomUUID(),
    name,
    enabled,
    notify: true,
    schedule,
    action,
    lastRunAt: lastHoursAgo == null ? null : at(lastHoursAgo),
    nextRunAt: enabled ? nextRun(schedule).toISOString() : null,
  });
  return [
    make('Morning brief', { kind: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] }, { type: 'brief' }, 3),
    make('End-of-day wrap-up', { kind: 'daily', time: '18:00', days: [1, 2, 3, 4, 5] }, { type: 'ask', prompt: 'What did I work on today, what is still uncommitted or unpushed, and what should I pick up first tomorrow?' }, 18),
    make('Dependency audit', { kind: 'interval', hours: 24 }, { type: 'claude', prompt: 'Run npm audit and summarise anything high or critical.', cwd: repoPath('orbit-api') }, 22, false),
  ];
}

const runOutput: Record<string, string> = {
  brief: BRIEF.focus.map((f, i) => `${i + 1}. ${f.action}`).join('\n'),
  ask: ANSWER,
  claude: '**npm audit:** 0 critical, 0 high, 2 moderate (both in dev dependencies). Nothing to fix urgently.',
};

// Replayed terminal output. Lines use \r\n because the terminal is in raw mode.
const C = { dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', bold: '\x1b[1m', reset: '\x1b[0m' };
const claudeReplay = (cwd: string, prompt?: string) =>
  prompt
    ? [
        `${C.cyan}${C.bold}✻ Claude Code${C.reset}`,
        `${C.dim}  ${cwd}${C.reset}`,
        '',
        `${C.bold}> ${prompt}${C.reset}`,
        '',
        `${C.green}●${C.reset} Read(TODO.md)`,
        `${C.green}●${C.reset} Grep(${prompt.split(': ').pop()?.split(' ').slice(0, 2).join(' ')})`,
        '',
        `${C.green}●${C.reset} Here's my plan: read the code this touches, make the change, then run the tests.`,
        '  Want me to start?',
        '',
        '> ',
      ].join('\r\n')
    : [
    `${C.cyan}${C.bold}✻ Claude Code${C.reset}`,
    `${C.dim}  ${cwd}${C.reset}`,
    '',
    `${C.bold}> add a per-key rate limit to the public API, 100 req/min, with tests${C.reset}`,
    '',
    `${C.green}●${C.reset} Read(src/middleware/auth.ts)`,
    `${C.green}●${C.reset} Read(src/routes/public.ts)`,
    `${C.green}●${C.reset} Write(src/middleware/rateLimit.ts)`,
    `${C.dim}  ⎿  Wrote 48 lines${C.reset}`,
    `${C.green}●${C.reset} Edit(src/routes/public.ts)`,
    `${C.green}●${C.reset} Bash(npm test -- rateLimit)`,
    `${C.dim}  ⎿  ${C.reset}${C.green}PASS${C.reset}${C.dim}  tests/rateLimit.test.ts (6 tests)${C.reset}`,
    '',
    `${C.green}●${C.reset} Added a sliding-window limiter keyed by API key on every /v1 route.`,
    '  429 responses include Retry-After. All 6 new tests pass.',
    '',
    '> ',
  ].join('\r\n');

// Skills: two used but unsaved, one already in the library.
const skillMd = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
const DEMO_SKILLS: Record<string, Omit<SkillReview, 'name'> & { url?: string }> = {
  'build-awards-website': {
    description: 'Design and build an award-quality marketing site: bold layout, motion, and a performance budget.',
    sourceKind: 'user',
    sourceLabel: '~/.claude/skills',
    files: [
      { path: 'SKILL.md', size: 1840, text: skillMd('build-awards-website', 'Design and build an award-quality marketing site: bold layout, motion, and a performance budget.', '# Build an award-quality website\n\n1. Ask for the brand, audience and one reference site.\n2. Sketch three layout directions and let the user pick one.\n3. Build with semantic HTML, fluid type and scroll-linked motion.\n4. Keep Lighthouse performance above 90; check it before finishing.') },
      { path: 'references/motion.md', size: 920, text: '# Motion rules\n\n- Ease-out for entrances, under 400 ms.\n- Respect prefers-reduced-motion.' },
    ],
    findings: [],
    hash: 'a'.repeat(64),
    totalBytes: 2760,
  },
  'creative-claw:creativeclaw-build-film': {
    description: 'Produce a multi-shot product film from a script, with narration and an assembled first cut.',
    sourceKind: 'plugin',
    sourceLabel: 'plugin creative-claw',
    files: [
      { path: 'SKILL.md', size: 2210, text: skillMd('creativeclaw-build-film', 'Produce a multi-shot product film from a script, with narration and an assembled first cut.', '# Build a film\n\nPlan the shots, get approval, then generate each clip and assemble them.\nRun scripts/assemble.sh with the clip list when every shot is approved.') },
      { path: 'scripts/assemble.sh', size: 310, text: '#!/usr/bin/env bash\nset -euo pipefail\nffmpeg -f concat -safe 0 -i "$1" -c copy out.mp4\n' },
    ],
    findings: [
      { level: 'info', file: 'SKILL.md', line: null, message: "From the creative-claw plugin. It may rely on that plugin's tools or connectors, which aren't copied. Check the plugin's licence before sharing it." },
      { level: 'warn', file: 'scripts/assemble.sh', line: null, message: 'Script Claude may run. Read it before trusting the skill.' },
    ],
    hash: 'b'.repeat(64),
    totalBytes: 2520,
  },
};
let demoLibrary: LibrarySkill[] = [
  {
    id: 'release-notes',
    name: 'release-notes',
    description: 'Write release notes from merged PRs since the last tag, grouped by user-facing change.',
    sourceKind: 'project',
    sourceLabel: 'repo orbit-api',
    savedAt: at(24 * 9),
    hash: 'c'.repeat(64),
    fileCount: 1,
    totalBytes: 1210,
    findings: [],
    tampered: false,
    userInstall: 'same',
    repoInstalls: [repoPath('orbit-api')],
    url: null,
  },
];
// Finder results: made-up repos, so demo mode never touches the network.
const ONLINE: (Omit<SkillSearchResult, 'inLibrary' | 'findings'> & { files: SkillReview['files'] })[] = [
  {
    id: 'demo-online-1',
    name: 'webapp-testing',
    description: 'Test local web apps with Playwright: start the server, click through key flows, and capture screenshots and console errors.',
    repo: 'anthropics/skills',
    path: 'skills/webapp-testing',
    sha: 'e3b1c0d9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3',
    url: 'https://github.com/anthropics/skills',
    stars: 18400,
    license: 'Apache-2.0',
    pushedAt: at(30),
    archived: false,
    fork: false,
    official: true,
    why: 'Official Anthropic skill for driving and checking a web app end to end.',
    concerns: '',
    files: [{ path: 'SKILL.md', size: 1400, text: skillMd('webapp-testing', 'Test local web apps with Playwright.', '# Web app testing\n\nStart the dev server, open the app with Playwright, walk the main flows and report failures with screenshots.') }],
  },
  {
    id: 'demo-online-2',
    name: 'landing-page-polish',
    description: 'Review a landing page for hierarchy, spacing, motion and Core Web Vitals, then apply fixes.',
    repo: 'studio-north/claude-skills',
    path: 'landing-page-polish',
    sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    url: 'https://github.com/studio-north/claude-skills',
    stars: 2310,
    license: 'MIT',
    pushedAt: at(24 * 6),
    archived: false,
    fork: false,
    official: false,
    why: 'Focused on making marketing pages look award-ready, with a performance check.',
    concerns: 'Uses a helper script for Lighthouse; read it first.',
    files: [
      { path: 'SKILL.md', size: 1650, text: skillMd('landing-page-polish', 'Review a landing page for hierarchy, spacing, motion and Core Web Vitals.', '# Landing page polish\n\nAudit the page, list the five biggest visual issues, fix them, then run scripts/lighthouse.sh.') },
      { path: 'scripts/lighthouse.sh', size: 140, text: '#!/usr/bin/env bash\nnpx lighthouse "$1" --only-categories=performance --quiet\n' },
    ],
  },
];
const demoDismissed = new Set<string>();
const demoPrompted = new Map<string, string>();
const demoCandidates = (): SkillCandidate[] =>
  [
    { name: 'build-awards-website', uses: 6, lastUsedAt: at(0.05), repos: [repoPath('orbit-web')] },
    { name: 'creative-claw:creativeclaw-build-film', uses: 3, lastUsedAt: at(20), repos: [repoPath('orbit-web'), repoPath('pocket-ledger')] },
  ]
    .filter((c) => !demoDismissed.has(c.name) && !demoLibrary.some((l) => l.name === c.name))
    .map((c) => ({ ...c, description: DEMO_SKILLS[c.name].description, sourceKind: DEMO_SKILLS[c.name].sourceKind, sourceLabel: DEMO_SKILLS[c.name].sourceLabel, changed: false, promptedAt: demoPrompted.get(c.name) ?? null }));

let localAi = true;
let billing: Settings['billing'] = 'api';
let planPrice = 20;
let skillPrompts = true;
export function demoSettings(): Settings {
  return { projectRoots: [ROOT], localModel: 'qwen3.5:9b', backgroundMode: false, saveTodos: true, localAi, billing, planPrice, skillPrompts };
}

/** Fake implementations for every IPC channel, keyed by channel name. */
export function demoHandlers(send: Send): Record<string, (...args: any[]) => unknown> {
  let routines = demoRoutines();
  const runs: RoutineRun[] = routines
    .filter((r) => r.lastRunAt)
    .map((r) => ({ id: randomUUID(), routineId: r.id, routineName: r.name, startedAt: r.lastRunAt!, finishedAt: r.lastRunAt!, status: 'ok' as const, output: runOutput[r.action.type] }));
  const ollama: OllamaStatus = { installed: true, running: true, version: '0.40.13', models: [{ name: 'qwen3.5:9b', sizeGB: 6.6, modifiedAt: at(120) }] };
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const terms = new Map<string, { prompt: string; line: string }>();

  /** Streams text a few words at a time, like a local model would. */
  const stream = (key: string, text: string, onText: (t: string) => void, onDone: () => void) => {
    const words = text.split(/(?<=\s)/);
    let i = 0;
    timers.set(
      key,
      setInterval(() => {
        if (i >= words.length) {
          clearInterval(timers.get(key));
          timers.delete(key);
          return onDone();
        }
        onText(words.slice(i, i + 3).join(''));
        i += 3;
      }, 35)
    );
  };
  const stop = (key: string) => {
    clearInterval(timers.get(key));
    timers.delete(key);
  };

  return {
    'settings:get': () => demoSettings(),
    'settings:setRoots': () => demoSettings(),
    'settings:setBackground': () => demoSettings(),
    'settings:setLocalModel': () => demoSettings(),
    'settings:setSaveTodos': () => demoSettings(),
    'settings:setSkillPrompts': (on: unknown) => {
      skillPrompts = on === true;
      return demoSettings();
    },
    'skills:candidates': () => demoCandidates(),
    'skills:review': (name: string) => {
      const s = DEMO_SKILLS[name];
      if (!s) throw new Error("That skill hasn't been used in any session");
      return { name, ...s };
    },
    // Demo writes nothing to disk: saving and installing only change the in-memory lists.
    'skills:save': (name: string) => {
      const s = DEMO_SKILLS[name];
      if (!s) return null;
      const saved: LibrarySkill = {
        id: name.split(':').pop()!,
        name,
        description: s.description,
        sourceKind: s.sourceKind,
        sourceLabel: s.sourceLabel,
        savedAt: new Date().toISOString(),
        hash: s.hash,
        fileCount: s.files.length,
        totalBytes: s.totalBytes,
        findings: s.findings,
        tampered: false,
        userInstall: null,
        repoInstalls: [],
        url: s.url ?? null,
      };
      demoLibrary = [saved, ...demoLibrary.filter((l) => l.id !== saved.id)];
      return saved;
    },
    'skills:search': (query: string, mode: string) =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              mode: mode === 'github' ? 'github' : 'claude',
              dropped: 1,
              costUSD: mode === 'github' ? null : 0.21,
              results: ONLINE.map(({ files, ...r }) => ({
                ...r,
                why: mode === 'github' ? '' : r.why,
                concerns: mode === 'github' ? '' : r.concerns,
                inLibrary: demoLibrary.some((l) => l.id === r.name),
                findings: files.length > 1 ? [{ level: 'warn' as const, file: 'scripts/lighthouse.sh', line: null, message: 'Script Claude may run. Read it before trusting the skill.' }] : [],
              })),
            }),
          mode === 'github' ? 700 : 2200
        )
      ),
    'skills:cancelSearch': () => undefined,
    'skills:reviewOnline': (id: string) => {
      const r = ONLINE.find((x) => x.id === id);
      if (!r) throw new Error('Search again: that result has expired.');
      const findings = [
        { level: 'info' as const, file: 'SKILL.md', line: null, message: `Downloaded from github.com/${r.repo} at commit ${r.sha.slice(0, 7)}. Later changes to the repo don't reach your copy.` },
        ...(r.files.length > 1 ? [{ level: 'warn' as const, file: 'scripts/lighthouse.sh', line: null, message: 'Script Claude may run. Read it before trusting the skill.' }] : []),
      ];
      return { name: r.name, description: r.description, sourceKind: 'online', sourceLabel: `github ${r.repo}`, files: r.files, findings, hash: 'd'.repeat(64), totalBytes: r.files.reduce((n, f) => n + f.size, 0) };
    },
    'skills:saveOnline': (id: string) => {
      const r = ONLINE.find((x) => x.id === id);
      if (!r) return null;
      const saved: LibrarySkill = {
        id: r.name,
        name: r.name,
        description: r.description,
        sourceKind: 'online',
        sourceLabel: `github ${r.repo}`,
        savedAt: new Date().toISOString(),
        hash: 'd'.repeat(64),
        fileCount: r.files.length,
        totalBytes: r.files.reduce((n, f) => n + f.size, 0),
        findings: [],
        tampered: false,
        userInstall: null,
        repoInstalls: [],
        url: r.url,
      };
      demoLibrary = [saved, ...demoLibrary.filter((l) => l.id !== saved.id)];
      DEMO_SKILLS[r.name] = { description: r.description, sourceKind: 'online', sourceLabel: `github ${r.repo}`, files: r.files, findings: [], hash: saved.hash, totalBytes: saved.totalBytes };
      return saved;
    },
    'skills:library': () => demoLibrary,
    'skills:libraryFiles': (id: string) => {
      const l = demoLibrary.find((x) => x.id === id);
      if (!l) throw new Error('Not in your library');
      const s = DEMO_SKILLS[l.name];
      return s
        ? { name: l.name, ...s }
        : { name: l.name, description: l.description, sourceKind: l.sourceKind, sourceLabel: l.sourceLabel, files: [{ path: 'SKILL.md', size: l.totalBytes, text: skillMd(l.id, l.description, '# Release notes\n\nList merged PRs since the last tag with gh, group them by what users will notice, and write one line each.') }], findings: [], hash: l.hash, totalBytes: l.totalBytes };
    },
    'skills:install': (id: string, target: 'user' | { repoPath: string }) => {
      const l = demoLibrary.find((x) => x.id === id);
      if (!l) return false;
      if (target === 'user') l.userInstall = 'same';
      else if (!l.repoInstalls.includes(target?.repoPath)) l.repoInstalls.push(target.repoPath);
      return true;
    },
    'skills:remove': (id: string) => {
      demoLibrary = demoLibrary.filter((l) => l.id !== id);
      return true;
    },
    'skills:dismiss': (name: string, how: string) => {
      if (how === 'never') demoDismissed.add(name);
      demoPrompted.set(name, new Date().toISOString());
    },
    'settings:setBilling': (b: unknown, price: unknown) => {
      billing = b === 'subscription' ? 'subscription' : 'api';
      planPrice = cleanPlanPrice(price);
      return demoSettings();
    },
    'settings:setLocalAi': (on: boolean) => {
      localAi = on === true;
      return demoSettings();
    },
    'todos:add': (repoPath: string, text: string) => {
      REPOS.find((r) => r.path === repoPath)?.todos.unshift(todo(String(text).trim(), 0));
    },
    'todos:complete': (repoPath: string, t: { line: number }) => {
      const r = REPOS.find((x) => x.path === repoPath);
      if (r) r.todos = r.todos.filter((x) => x.line !== t?.line);
    },
    'sessions:delete': (ids: string[]) => {
      const before = SESSIONS.length;
      for (const id of ids ?? []) {
        const i = SESSIONS.findIndex((s) => s.id === id);
        if (i >= 0) SESSIONS.splice(i, 1);
      }
      return before - SESSIONS.length;
    },
    'dialog:pickFolder': () => null,
    'shell:openExternal': () => undefined,

    'repos:list': () => REPOS,
    'sessions:list': () => SESSIONS.map(({ transcript: _t, ...s }) => s),
    'sessions:transcript': (id: string) => SESSIONS.find((s) => s.id === id)?.transcript ?? [],
    'sessions:search': (q: string) => {
      const needle = String(q).toLowerCase();
      return SESSIONS.flatMap((s) => {
        const hit = s.transcript.find((t) => t.kind !== 'tool' && t.text.toLowerCase().includes(needle));
        return hit && hit.kind !== 'tool' ? [{ id: s.id, snippet: hit.text.slice(0, 120) }] : [];
      });
    },
    'prs:list': () => PRS,

    'routines:list': () => routines,
    'routines:runs': () => runs,
    'routines:save': (r: RoutineInput) => {
      const existing = routines.find((x) => x.id === r?.id);
      const saved: Routine = { ...r, id: existing?.id ?? randomUUID(), lastRunAt: existing?.lastRunAt ?? null, nextRunAt: r.enabled ? nextRun(r.schedule).toISOString() : null };
      routines = existing ? routines.map((x) => (x.id === saved.id ? saved : x)) : [...routines, saved];
      return saved;
    },
    'routines:delete': (id: string) => {
      routines = routines.filter((r) => r.id !== id);
    },
    'routines:runNow': (id: string) => {
      const r = routines.find((x) => x.id === id);
      if (!r) return;
      const run: RoutineRun = { id: randomUUID(), routineId: r.id, routineName: r.name, startedAt: new Date().toISOString(), finishedAt: null, status: 'running', output: '' };
      runs.unshift(run);
      send('routines:run', { ...run });
      setTimeout(() => {
        Object.assign(run, { status: 'ok', finishedAt: new Date().toISOString(), output: runOutput[r.action.type] });
        r.lastRunAt = run.finishedAt;
        send('routines:run', { ...run });
      }, 1800);
    },

    'system:usage': (): SystemUsage => {
      const jitter = (base: number, spread: number) => Math.round(base + (Math.random() - 0.5) * spread);
      return { cpuPct: jitter(18, 14), ramUsedGB: 15.2 + Math.random() * 0.6, ramTotalGB: 32, gpu: { name: 'NVIDIA GeForce RTX 4070', pct: jitter(12, 16), vramUsedGB: localAi ? 7.4 : 0.9, vramTotalGB: 12 } };
    },
    'ai:scan': () => buildReport(SYSTEM, false) as Promise<ModelReport>,
    'ai:status': () => ollama,
    'ai:start': () => true,
    'ai:brief': () => new Promise((resolve) => setTimeout(() => resolve(localAi ? BRIEF : { ...BRIEF, model: null, usedModel: false }), 600)),
    'ai:pull': (tag: string) => {
      const total = 5.2 * 1024 ** 3;
      let completed = 0;
      timers.set(
        `pull:${tag}`,
        setInterval(() => {
          completed = Math.min(total, completed + total / 40);
          if (completed < total) return send('ai:pull-progress', { tag, status: 'pulling', completed, total });
          stop(`pull:${tag}`);
          ollama.models.push({ name: tag, sizeGB: 5.2, modifiedAt: new Date().toISOString() });
          send('ai:pull-progress', { tag, status: 'success', done: true });
        }, 150)
      );
    },
    'ai:cancelPull': (tag: string) => {
      stop(`pull:${tag}`);
      send('ai:pull-progress', { tag, status: 'error', done: true, error: 'Cancelled' });
    },
    'ai:remove': (tag: string) => {
      ollama.models = ollama.models.filter((m) => m.name !== tag);
    },
    'ai:run': (task: AiTask) => {
      const taskId = randomUUID();
      const ev = (e: object) => send('ai:event', { taskId, ...e });
      setTimeout(() => {
        ev({ context: task?.kind === 'summarize' ? ['this session'] : ['orbit-api', 'orbit-web', 'pocket-ledger', '2 PRs to review'] });
        stream(taskId, task?.kind === 'summarize' ? SUMMARY : ANSWER, (text) => ev({ text }), () => ev({ done: true }));
      }, 400);
      return taskId;
    },
    'ai:cancel': (id: string) => {
      stop(id);
      send('ai:event', { taskId: id, done: true, error: 'Stopped' });
    },

    'term:create': (spec: TerminalSpec) => {
      const id = randomUUID();
      const known = REPOS.find((r) => r.path === spec?.cwd);
      const cwd = known?.path ?? ROOT;
      const shellPrompt = process.platform === 'win32' ? `PS ${cwd}> ` : `${C.green}dev@cockpit${C.reset}:${C.cyan}${cwd.replace('/home/dev', '~')}${C.reset}$ `;
      const isClaude = spec?.program !== 'shell' && spec?.program !== 'ollama-install';
      terms.set(id, { prompt: isClaude ? '> ' : shellPrompt, line: '' });
      setTimeout(() => send('term:data', id, isClaude ? claudeReplay(cwd, spec?.prompt) : shellPrompt), 150);
      return id;
    },
    // Typing is echoed locally so the terminal feels alive; nothing is executed.
    'term:write': (id: string, data: string) => {
      const t = terms.get(id);
      if (!t) return;
      for (const ch of String(data)) {
        if (ch === '\r') {
          send('term:data', id, `\r\n${t.line.trim() ? `${C.dim}(demo mode: commands don't run)${C.reset}\r\n` : ''}${t.prompt}`);
          t.line = '';
        } else if (ch === '\x7f') {
          if (t.line) send('term:data', id, '\b \b');
          t.line = t.line.slice(0, -1);
        } else if (ch >= ' ') {
          t.line += ch;
          send('term:data', id, ch);
        }
      }
    },
    'term:resize': () => undefined,
    // Real clipboard so copy and paste work in demo mode; main gates both behind a real gesture.
    'clipboard:read': async () => (await clipboard.readText()).slice(0, 1_000_000),
    'clipboard:write': (text: string) => clipboard.writeText(String(text).slice(0, 1_000_000)),
    'term:kill': (id: string) => {
      terms.delete(id);
    },
  };
}
