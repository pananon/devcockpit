## What changed

<!-- One change per PR. What does it do, and why? Link the issue if there is one. -->

## How I tested it

<!-- Steps you ran. For UI changes, add a screenshot from `npm run demo`. -->

## Checklist

- [ ] `npm run typecheck` and `npm run build` pass
- [ ] New IPC channels validate their arguments in `src/main/index.ts` and have a fake answer in `src/main/demo.ts`
- [ ] No shell strings, no HTML rendering of untrusted text, no new stored credentials (see CONTRIBUTING.md)
- [ ] Works with local AI switched off
- [ ] No new runtime dependencies, or the reason is explained above
- [ ] Screenshots use demo mode, not real data
