import { describe, expect, it } from "vitest";
import { isTransient, recoverStalledRetry } from "./recovery";

describe("XDC retry recovery", () => {
  it("requeues all eight stale retry wallets but leaves live and terminal wallets alone", async () => {
    const now = Date.parse("2026-10-29T19:05:00Z");
    const base = { run_id: "xdc-run", phase1_status: "failed_gas", phase2_status: "claiming", final_status: "pending", updated_at: "2026-10-28T16:28:46Z" };
    const rows = [...Array.from({ length: 8 }, () => ({ ...base })),
      { ...base, updated_at: "2026-10-29T19:04:00Z" },
      { ...base, final_status: "success" }, { ...base, run_id: "other-run" }];
    let patch = {};
    const filters: Array<(row: typeof base) => boolean> = [];
    const query = {
      update(value: object) { patch = value; return this; },
      eq(key: keyof typeof base, value: string) { filters.push(row => row[key] === value); return this; },
      async lt(key: keyof typeof base, cutoff: string) {
        rows.filter(row => filters.every(fn => fn(row)) && Date.parse(row[key]) < Date.parse(cutoff)).forEach(row => Object.assign(row, patch));
        return { error: null };
      },
    };
    await recoverStalledRetry({ from: () => query }, "xdc-run", now);
    expect(rows.filter(row => row.phase2_status === "pending")).toHaveLength(8);
    expect(rows.slice(8).every(row => row.phase2_status === "claiming")).toBe(true);
  });
  it.each(["HTTP 503: Application Error", "HTTP 429: Too many requests"])("retries temporary XDC response %s", error => {
    expect(isTransient(error)).toBe(true);
  });
  it("does not retry a whitelist rejection as a connection failure", () => {
    expect(isTransient('execution reverted: "UBIScheme: not whitelisted"')).toBe(false);
  });
});