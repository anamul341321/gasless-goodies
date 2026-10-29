# Architecture rules
- Keep daily claim transient-error classification and stale retry-wave recovery in its runtime-independent recovery module with regression tests, so interrupted gas retries cannot strand wallets.
- Keep existing gas-loader-worker response classification and balance-evidence checks in its browser-independent verification module, with focused tests, so faucet acknowledgement cannot be mistaken for confirmed gas delivery.
- gas-loader-worker first lets a wallet with a stored key call the GoodDollar faucet contract's topWallet(self) when it can pay that call, and only then asks the GoodDollar server; the server replies {ok:1} without sending gas to wallets that can afford the call themselves.
