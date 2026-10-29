import { describe, expect, it } from "vitest";
import { canAffordSelfTopUp, faucetRejection, hasGasIncrease } from "./verification";

describe("gas delivery evidence", () => {
  it("does not treat a plain faucet acknowledgement as gas delivery", () => {
    expect(faucetRejection({ ok: 1 })).toBeNull();
    expect(hasGasIncrease(62_200_000_000_000_000n, 62_200_000_000_000_000n)).toBe(false);
  });
  it("requires an actual increase, not an app-side 0.09 CELO threshold", () => {
    expect(hasGasIncrease(90_000_000_000_000_000n, 90_000_000_000_000_000n)).toBe(false);
    expect(hasGasIncrease(1n, 2n)).toBe(true);
  });
  it("rejects unknown or decreasing balances", () => {
    expect(hasGasIncrease(null, 2n)).toBe(false);
    expect(hasGasIncrease(2n, null)).toBe(false);
    expect(hasGasIncrease(2n, 1n)).toBe(false);
  });
  it("separates explicit gas sufficiency from new delivery", () => {
    expect(faucetRejection({ ok: 1, message: "Already has enough gas" })).toContain("no new gas transfer");
  });
  it("recognizes numeric faucet rejection", () => {
    expect(faucetRejection({ ok: 0, message: "faucet abuse" })).toBe("faucet abuse");
    expect(faucetRejection({ ok: -1, error: "not whitelisted" })).toBe("not whitelisted");
  });
  it("lets a wallet with 0.062 CELO call the faucet itself at 202.5 gwei", () => {
    // 128_804 gas * 1.2 * 202.5 gwei ≈ 0.0313 CELO
    expect(canAffordSelfTopUp(62_197_130_000_000_000n, 128_804n, 202_500_000_000n)).toBe(true);
  });
  it("does not self-call when the wallet cannot pay the faucet call", () => {
    expect(canAffordSelfTopUp(18_272_877_264_280_166n, 128_804n, 202_500_000_000n)).toBe(false);
    expect(canAffordSelfTopUp(null, 128_804n, 202_500_000_000n)).toBe(false);
  });
});