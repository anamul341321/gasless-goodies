import { expect, it } from "vitest";
import { dailyResultVersion } from "./daily-claim-results";

it("invalidates the first 1,000 cached results when the remaining Fuse claims finish", () => {
  const group = { run: { id: "fuse-run", phase: "claiming", total: 5000, success: 1000, final_failed: 0, finished_at: null }, breakdown: { success: 1000, pending: 4000 }, failed_key_count: 0 };
  const finished = { ...group, run: { ...group.run, success: 5000, phase: "completed" }, breakdown: { success: 5000, pending: 0 } };
  expect(dailyResultVersion(finished)).not.toBe(dailyResultVersion(group));
  expect(dailyResultVersion(finished)).toBe(dailyResultVersion({ ...finished }));
});