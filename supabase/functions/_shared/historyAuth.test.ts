import { afterEach, describe, expect, it, vi } from "vitest";
import { ownsHistory, ownsJob } from "./historyAuth";

describe("private histories", () => {
  it("allows the owner of a gas-load history", () => { expect(ownsHistory("owner-a", "owner-a")).toBe(true); });
  it("denies another user's manual claim history", () => { expect(ownsHistory("owner-a", "owner-b")).toBe(false); });
  it("denies another user's auto claim history", () => { expect(ownsHistory("owner-b", "owner-a")).toBe(false); });
  it("denies unsigned callers", () => { expect(ownsHistory("owner-a", null)).toBe(false); });
  it("never adopts legacy ownerless history", () => { expect(ownsHistory(null, "owner-a")).toBe(false); });
  it("does not authorize two missing identities", () => { expect(ownsHistory(null, null)).toBe(false); });
});

describe("verified owner endpoint boundary", () => {
  afterEach(() => vi.unstubAllGlobals());
  const jobId = "00000000-0000-0000-0000-000000000001";
  const request = () => new Request("https://app.example/status", { headers: { Authorization: "Bearer test-session" } });
  function setup(owner: string | null) {
    vi.stubGlobal("Deno", { env: { get: (name: string) => name === "SUPABASE_URL" ? "https://backend.example" : "test-key" } });
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/auth/v1/user") ? { id: "user-a" } : owner ? [{ owner_user_id: owner }] : [])));
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }
  it("reads gas history only using the verified owner filter", async () => {
    const fetcher = setup("user-a");
    expect(await ownsJob(request(), "gas_load_jobs", jobId)).toBe(true);
    expect(fetcher.mock.calls[1]?.[0]).toContain("owner_user_id=eq.user-a");
  });
  it("denies foreign history even if the lookup returns an unexpected owner", async () => {
    setup("user-b");
    expect(await ownsJob(request(), "gd_bulk_jobs", jobId)).toBe(false);
  });
  it("never uses knowledge of a job ID as authorization", async () => {
    const fetcher = setup("user-a");
    expect(await ownsJob(new Request("https://app.example/status"), "gas_load_jobs", jobId)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});