# Progress

## Current state

Stage A, session A1 (project setup and the first check, locally) is in progress on branch `a1-setup`.

## A1: project setup and the first check, locally (20.11.2026)

- Step 1: repository initialised. First commit on `main` contains only `design/` and `docs/brief.md`.
- Step 2: `.gitignore`, `.gitattributes`, `CLAUDE.md`, `docs/progress.md`, `docs/decisions.md`, `docs/backlog.md`.
- Step 3: npm workspaces `scanner/` and `worker/`, TypeScript 6.0.3 strict, Vitest 5.1.1, Node 24.15.0 pinned. `npm test`: 2 of 2 tests pass; `npm run typecheck`: no errors.
- Step 4: rules data for third-party services: 95 services with 224 host patterns (precedent 1, consent-required 17, usually-consent 14, grey-zone 47, not-flagged 16) and 132 sources in docs/rules-sources.md. A research pass with 12 helpers opened every source twice (research plus an independent attempt to refute it); none was rejected, uncertain classes went to grey-zone.
- Steps 5 to 7: local Playwright capture adapter (Chromium, de-DE, Europe/Berlin, 1440 x 900, no interaction, network quiet or at most 15 s, banner probe), third-party analyzer, local runner (npm run scan:local) and explain tool (npm run explain). npm test: 116 unit tests pass; npm run test:integration: 10 of 10 pass.
- Step 8: 30 test sites in `local/sites.txt` (git-ignored): 12 online shops (4 Shopify, 4 WooCommerce, 4 Shopware), 12 small service businesses (3 craftsmen, 3 restaurants or inns, 3 practices, 3 agencies; 8 on WordPress, 4 on other systems), 6 sites on Wix (3) and Jimdo (3). All 30 are businesses in Bavaria. Research helpers proposed 61 candidates, each with one homepage fetch to confirm the system; a second helper checked each candidate and rejected 9 (one homepage with injected gambling spam, a chain, a non-shop, unverifiable owners, a hobby offer, duplicate Jimdo domains).
