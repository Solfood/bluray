# Work Index

<!-- Priority: high/med/low | Parent refs: related marker IDs or DEC-NNNN links -->

## Active

| ID | Title | Status | Priority | Parent refs | Updated |
|---|---|---|---|---|---|
| BLU-ARCH-0002 | Refactor static SPA to self-hosted React Router v7 full-stack app | IN_PROGRESS | high | DEC-0002 | 2026-07-10 |

<!-- BLU-ARCH-0002 Gate 4 evidence: docs/evidence/BLU-ARCH-0002-test-run-2026-07-10.txt
     (66/66 tests pass @ fd27b58; 41-movie import verified 41 rows in SQLite).
     Remaining before DONE: parallel run on bluray.local, cutover, first successful
     automated backup push (DEC-0002 gate for old-code deletion). -->
| BLU-ARCH-0003 | Retire legacy static app — delete web/, Python scrapers, enrichment workflow; update CLAUDE.md Files table | PLANNED | med | BLU-ARCH-0002, DEC-0002 | 2026-07-10 |

## Completed

| ID | Title | Status | Priority | Parent refs | Updated |
|---|---|---|---|---|---|
| BLU-DX-0001 | Bootstrap engineering scaffold | DONE | med | SUITE-DX-0001 | 2026-04-24 |
| BLU-ARCH-0001 | Remove stale database_files submodule | DONE | high | — | 2026-04-24 |
| BLU-FIX-0001 | Dedup moviesMatch into shared util | DONE | low | — | 2026-04-24 |
| BLU-DX-0002 | Tidy root-level dev tools | DONE | low | — | 2026-04-24 |
| BLU-DX-0003 | Refactor App.jsx — extract useLookup hook + pure utils | DONE | med | — | 2026-04-24 |
| BLU-FIX-0002 | enrich.yml [skip ci], redundant OpenDB call, dead chunk code | DONE | med | — | 2026-04-24 |
| BLU-DATA-0001 | Add genres + tagline to details_scraper enrichment | DONE | low | — | 2026-04-24 |
| BLU-API-0001 | Claude cover photo identification (Scanner + useLookup) | DONE | high | — | 2026-04-24 |
| BLU-API-0002 | GitHub Gist settings vault (cross-device key sync) | DONE | high | — | 2026-04-24 |
| BLU-OBS-0001 | Anthropic usage counter + structured error handling | DONE | med | BLU-API-0001 | 2026-04-24 |
| BLU-UX-0001 | Genre filter chips on home screen | DONE | med | BLU-DATA-0001 | 2026-04-24 |
| BLU-UX-0002 | Display enrichment data in MovieDetail | DONE | med | BLU-DATA-0001 | 2026-04-24 |

## Dropped

| ID | Title | Status | Priority | Parent refs | Updated |
|---|---|---|---|---|---|
| _none_ | | | | | |
