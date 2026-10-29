export function hasGasIncrease(before: bigint | null, after: bigint | null): boolean {
  return before !== null && after !== null && after > before;
}

export function faucetRejection(body: Record<string, unknown>): string | null {
  const message = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "";
  if (body.ok === false || body.ok === 0 || body.success === false || body.error) {
    return message || "GoodDollar rejected the gas request";
  }
  if (/\b(enough|sufficient)\s+(gas|balance|funds)\b|\b(balance|gas)\s+is\s+(enough|sufficient)\b/i.test(message)) {
    return `GoodDollar says gas is sufficient; no new gas transfer: ${message}`;
  }
  return null;
}