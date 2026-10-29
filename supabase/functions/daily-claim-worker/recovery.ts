// Shared recovery policy; independent of the edge runtime for regression tests.
export function isTransient(msg: string) {
  const m = (msg || "").toLowerCase();
  return /\bhttp\s*(?:status\s*)?[:=]?\s*(?:429|5\d\d)\b/.test(m) || [
    "could not coalesce", "missing response", "server response 5", "server response 4",
    "nonce has already been used", "replacement fee too low", "nonce too low",
    "transaction underpriced", "timeout", "timed out", "rate limit", "too many requests",
    "network error", "connection", "fetch failed", "bad request", "dns",
    "temporary failure", "failed to lookup", "econn", "socket",
  ].some((fragment) => m.includes(fragment));
}

export async function recoverStalledRetry(db: any, runId: string, now = Date.now()) {
  const { error } = await db.from("daily_claim_run_items")
    .update({ phase2_status: "pending" })
    .eq("run_id", runId)
    .eq("phase1_status", "failed_gas")
    .eq("phase2_status", "claiming")
    .eq("final_status", "pending")
    .lt("updated_at", new Date(now - 2 * 60 * 1000).toISOString());
  if (error) throw new Error(`Retry recovery failed: ${error.message}`);
}