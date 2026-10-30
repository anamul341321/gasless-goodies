export const CLAIM_EVIDENCE_ABI = [
  "function periodStart() view returns (uint256)",
  "function lastClaimed(address) view returns (uint256)",
];
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function claimedInPeriod(last: bigint, start: bigint, timestamp: bigint) {
  if (start <= 0n || timestamp < start || last <= 0n || last > timestamp) return false;
  const boundary = start + ((timestamp - start) / 86400n) * 86400n;
  return last >= boundary;
}

export function receivedGd(logs: any[], wallet: string, token: string) {
  const recipient = "0x" + "0".repeat(24) + wallet.slice(2).toLowerCase();
  return logs.some(log => {
    const topics = (log.topics || []).map((topic: unknown) => String(topic).toLowerCase());
    if (String(log.address).toLowerCase() !== token.toLowerCase() || topics[0] !== TRANSFER_TOPIC || topics[2] !== recipient) return false;
    try { return BigInt(log.data || "0x0") > 0n; } catch { return false; }
  });
}

// Use one block for both timestamps; never infer a prior claim from entitlement.
export async function verifyPriorClaim(ubi: any, provider: any, wallet: string): Promise<boolean> {
  try {
    const block = await provider.getBlock("latest");
    if (!block) return false;
    const options = { blockTag: block.number };
    const [start, last] = await Promise.all([
      ubi.periodStart(options), ubi.lastClaimed(wallet, options),
    ]);
    return claimedInPeriod(BigInt(last), BigInt(start), BigInt(block.timestamp));
  } catch { return false; } // Unsupported or unavailable reads are unknown, not already claimed.
}