# Tasks
- [ ] Add owner-only manual retry for daily gas failures, preserving schedules and successful wallets.
- [ ] Replace unproven already-claimed results with verified on-chain evidence and regression tests.
- [ ] Verify current results, gas loader behavior, and manual retry through the signed-in page.
- [x] Hide past daily G$ claim history without deleting data or current results (source verified; signed-in browser check unavailable).
- [x] Fix stale XDC retry waves and temporary HTTP failures; 11 regression tests pass, deployed worker resolved the eight stranded rows as already claimed.
- [x] Remove the app-imposed gas cooldown.
- [x] Fix gas delivery verification and investigate the faucet response.
- [x] Test and deploy the existing gas worker; live request now correctly reports unchanged balance instead of success.
- [x] Find why GoodDollar replies OK but sends no gas; wallets with a saved key now call the faucet themselves (live test: 0.062 → 0.346 CELO).
