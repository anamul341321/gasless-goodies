import { describe, expect, it } from "vitest";
import { readClaimQueue, summarizeClaimQueue } from "./manualClaimAggregate";

describe("manual claim full batch totals", () => {
  const completed = [
    ...Array.from({ length: 3858 }, () => ({ status: "success" })),
    ...Array.from({ length: 34 }, () => ({ status: "failed_kyc" })),
    { status: "already_claimed" }, { status: "already_claimed" }, { status: "failed_gas" },
  ];
  const cappedFetch = (rows: { status: string }[]) => (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get("offset"));
    expect(url.searchParams.get("order")).toBe("id.asc");
    return Response.json(rows.slice(offset, offset + Math.min(1000, Number(url.searchParams.get("limit")))));
  }) as typeof fetch;

  it("counts all 3,895 wallets, including 3,858 successes and 37 other results", async () => {
    const rows = await readClaimQueue<{ status: string }>("https://example.test/queue", {}, cappedFetch(completed));
    expect(rows).toHaveLength(3895);
    expect(summarizeClaimQueue(rows)).toEqual({ done: 3858, failed: 37, needsGas: 1, activeRemaining: 0, allDone: true });
  });
  it("does not complete a batch while a wallet beyond row 1,000 is pending", async () => {
    const rows = await readClaimQueue<{ status: string }>("https://example.test/queue", {}, cappedFetch([...completed, { status: "pending" }]));
    expect(summarizeClaimQueue(rows).allDone).toBe(false);
    expect(summarizeClaimQueue(rows).activeRemaining).toBe(1);
  });
  it("includes gas failures beyond row 1,000 in gas recovery", async () => {
    const rows = await readClaimQueue<{ status: string }>("https://example.test/queue", {}, cappedFetch(Array.from({ length: 3800 }, () => ({ status: "failed_gas" }))));
    expect(summarizeClaimQueue(rows).needsGas).toBe(3800);
  });
  it("rejects partial totals when a later page fails", async () => {
    const request = (async (input: RequestInfo | URL) => new URL(String(input)).searchParams.get("offset") === "0"
      ? Response.json(completed.slice(0, 500)) : new Response("failed", { status: 503 })) as typeof fetch;
    await expect(readClaimQueue("https://example.test/queue", {}, request)).rejects.toThrow("503");
  });
});