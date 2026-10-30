import { describe, expect, it } from "vitest";
import { prepareGasRetry } from "./daily-claim-retry";

function fixture() {
  const run = { id: "run", owner_user_id: "owner", phase: "completed", final_failed: 1201, enabled: true, start_hour_bd: 18 };
  const rows = [
    ...Array.from({ length: 1201 }, (_, i) => ({ id: String(i), run_id: "run", owner_user_id: "owner", final_status: "failed_gas", encrypted_key: "encrypted" })),
    { id: "ok", run_id: "run", owner_user_id: "owner", final_status: "success", encrypted_key: null },
    { id: "already", run_id: "run", owner_user_id: "owner", final_status: "already_claimed", encrypted_key: "encrypted" },
    { id: "other", run_id: "run", owner_user_id: "other", final_status: "failed_gas", encrypted_key: "encrypted" },
  ];
  const db = { from(table: string) {
    const source: any[] = table === "daily_claim_runs" ? [run] : rows;
    const filters: Array<(r: any) => boolean> = [];
    let patch: any; let maximum = Infinity; let countOnly = false;
    const q = {
      select(_fields: string, options?: { head?: boolean }) { countOnly = !!options?.head; return q; },
      eq(key: string, value: unknown) { filters.push(r => r[key] === value); return q; },
      not(key: string, _op: string, value: unknown) { filters.push(r => r[key] !== value); return q; },
      in(key: string, values: unknown[]) { filters.push(r => values.includes(r[key])); return q; },
      limit(value: number) { maximum = value; return q; },
      update(value: any) { patch = value; return q; },
      execute() { const matches = source.filter(r => filters.every(f => f(r))).slice(0, maximum); if (patch) matches.forEach(r => Object.assign(r, patch)); return { data: countOnly ? null : matches, count: matches.length, error: null }; },
      async maybeSingle() { const result = q.execute(); return { ...result, data: result.data?.[0] ?? null }; },
      then(resolve: (value: any) => unknown) { return Promise.resolve(q.execute()).then(resolve); },
    };
    return q;
  } };
  return { db, run, rows };
}

describe("Owner manual gas retry", () => {
  it("retries all 1201 gas failures without redoing successes, prior claims or another owner", async () => {
    const { db, run, rows } = fixture();
    expect(await prepareGasRetry(db, "run", "owner")).toEqual({ runId: "run", retried: 1201 });
    expect(rows.filter(r => r.final_status === "pending")).toHaveLength(1201);
    expect(rows.slice(-3).map(r => r.final_status)).toEqual(["success", "already_claimed", "failed_gas"]);
    expect(run.phase).toBe("claiming");
    expect(run.start_hour_bd).toBe(18);
    expect(run.enabled).toBe(true);
  });
  it("does not allow another owner to restart a run", async () => {
    const { db, run } = fixture();
    await expect(prepareGasRetry(db, "run", "stranger")).rejects.toThrow("Batch not found");
    expect(run.phase).toBe("completed");
  });
  it("rejects restart while automatic claim is running", async () => {
    const { db, run } = fixture(); run.phase = "retrying";
    await expect(prepareGasRetry(db, "run", "owner")).rejects.toThrow("still running");
  });
});