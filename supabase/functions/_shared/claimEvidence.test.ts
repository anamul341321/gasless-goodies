import { describe, expect, it } from "vitest";
import { claimedInPeriod, receivedGd, verifyPriorClaim } from "./claimEvidence";

describe("Prior claim evidence", () => {
  it("uses the deployed noon period, not midnight or a stale currentDay", () => {
    const start = BigInt(Date.parse("2026-10-28T12:00:00Z") / 1000);
    const now = start + 2n * 86400n;
    expect(claimedInPeriod(now - 1n, start, now)).toBe(false);
    expect(claimedInPeriod(now, start, now)).toBe(true);
  });
  it("does not call an unclaimed or future timestamp already claimed", () => {
    expect(claimedInPeriod(0n, 100n, 200n)).toBe(false);
    expect(claimedInPeriod(201n, 100n, 200n)).toBe(false);
  });
  it("unavailable contract evidence is not proof", async () => {
    expect(await verifyPriorClaim({}, { getBlock: async () => ({ number: 1, timestamp: 200 }) }, "wallet")).toBe(false);
  });
});
describe("Real G$ receipt", () => {
  const wallet = "0x" + "a".repeat(40);
  const token = "0x" + "b".repeat(40);
  const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const recipient = "0x" + "0".repeat(24) + wallet.slice(2);
  const log = { address: token, topics: [topic, "0x" + "0".repeat(64), recipient], data: "0x01" };
  it("requires a positive Transfer to the wallet from the configured token", () => {
    expect(receivedGd([log], wallet, token)).toBe(true);
    expect(receivedGd([{ ...log, data: "0x00" }], wallet, token)).toBe(false);
    expect(receivedGd([{ ...log, address: wallet }], wallet, token)).toBe(false);
    expect(receivedGd([{ ...log, topics: [topic, recipient, "0x" + "0".repeat(64)] }], wallet, token)).toBe(false);
    expect(receivedGd([], wallet, token)).toBe(false);
  });
});