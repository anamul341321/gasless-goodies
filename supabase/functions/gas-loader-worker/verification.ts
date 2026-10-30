export function hasGasIncrease(before: bigint | null, after: bigint | null): boolean {
  return before !== null && after !== null && after > before;
}

export function faucetRejection(body: Record<string, unknown>): string | null {
  const message = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "";
  if (body.ok === false || body.ok === 0 || body.ok === -1 || body.success === false || body.error) {
    return message || "GoodDollar rejected the gas request";
  }
  if (/\b(enough|sufficient)\s+(gas|balance|funds)\b|\b(balance|gas)\s+is\s+(enough|sufficient)\b/i.test(message)) {
    return `GoodDollar says gas is sufficient; no new gas transfer: ${message}`;
  }
  return null;
}

// GoodDollar's server replies {ok:1} WITHOUT sending gas when the wallet can
// afford to call the faucet contract itself. In that case the wallet must sign
// faucet.topWallet(self). The call is sent with a gas limit 5% above the
// estimate; a wider margin locks out wallets GoodDollar already refuses to fund.
export function selfTopUpGasLimit(estimate: bigint): bigint {
  return (estimate * 105n) / 100n;
}

export function canAffordSelfTopUp(balance: bigint | null, gasLimit: bigint, gasPrice: bigint): boolean {
  if (balance === null || gasLimit <= 0n || gasPrice <= 0n) return false;
  return balance >= selfTopUpGasLimit(gasLimit) * gasPrice;
}
