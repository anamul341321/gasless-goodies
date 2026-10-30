# Architecture rules
- Keep the npm lockfile synchronized with package.json and React-compatible dependency peers so external hosts can install without bypassing dependency checks; use NITRO_PRESET=node-server for Render while preserving Lovable's managed deployment target.
- Keep owner-only daily gas retry locking and row selection in a tested helper behind an authenticated server function; preserve schedules and terminal successful wallets.
- Share receipt and current-period claim evidence across both existing claim workers; zero entitlement and missing transfers never prove a prior claim.
- Keep daily claim transient-error classification and stale retry-wave recovery in its runtime-independent recovery module with regression tests, so interrupted gas retries cannot strand wallets.
- Keep existing gas-loader-worker response classification and balance-evidence checks in its browser-independent verification module, with focused tests, so faucet acknowledgement cannot be mistaken for confirmed gas delivery.
- gas-loader-worker first lets a wallet with a stored key call the GoodDollar faucet contract's topWallet(self) when it can pay that call, and only then asks the GoodDollar server; the server replies {ok:1} without sending gas to wallets that can afford the call themselves.
