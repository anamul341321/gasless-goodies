import { describe, expect, it } from "vitest";
import { readAllPages } from "./pagination";

describe("daily claim result pagination", () => {
  it("returns all 5,000 Fuse wallet results despite a server row cap", async () => {
    const wallets = Array.from({ length: 5000 }, (_, id) => ({ id, network: "fuse" }));
    const results = await readAllPages(async (from, to) => ({
      data: wallets.slice(from, Math.min(to + 1, from + 1000)), error: null,
    }), 1500);
    expect(results).toEqual(wallets);
    expect(results[4999]).toEqual({ id: 4999, network: "fuse" });
  });
  it("does not silently return partial results on a later page error", async () => {
    await expect(readAllPages(async (from) => from === 0
      ? { data: [1], error: null }
      : { data: null, error: new Error("page failed") }
    )).rejects.toThrow("page failed");
  });
});