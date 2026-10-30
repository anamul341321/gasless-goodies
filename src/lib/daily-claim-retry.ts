// Run locking and row filters are kept here so owner/retry rules are testable.
export async function prepareGasRetry(db: any, runId: string, ownerId: string) {
  const { data: run, error } = await db.from("daily_claim_runs")
    .select("id, owner_user_id, phase, final_failed")
    .eq("id", runId).eq("owner_user_id", ownerId).maybeSingle();
  if (error) throw error;
  if (!run) throw new Error("Batch not found");
  if (run.phase !== "completed") throw new Error("This batch is still running");
  const { count, error: countError } = await db.from("daily_claim_run_items")
    .select("id", { count: "exact", head: true }).eq("run_id", runId)
    .eq("owner_user_id", ownerId).eq("final_status", "failed_gas")
    .not("encrypted_key", "is", null);
  if (countError) throw countError;
  if (!count) throw new Error("No gas-failed wallets to retry");
  const { data: lock, error: lockError } = await db.from("daily_claim_runs")
    .update({ phase: "preparing_retry" }).eq("id", runId)
    .eq("owner_user_id", ownerId).eq("phase", "completed").select("id").maybeSingle();
  if (lockError) throw lockError;
  if (!lock) throw new Error("This batch is already restarting");
  let reset = 0;
  try {
    // Drain, rather than offset-page, a changing result set. No 1,000-row cap.
    while (true) {
      const { data: rows, error: pageError } = await db.from("daily_claim_run_items")
        .select("id").eq("run_id", runId).eq("owner_user_id", ownerId)
        .eq("final_status", "failed_gas").not("encrypted_key", "is", null).limit(500);
      if (pageError) throw pageError;
      if (!rows?.length) break;
      const { error: resetError } = await db.from("daily_claim_run_items").update({
        phase1_status: "pending", phase1_error: null, phase1_tx: null,
        phase2_status: null, phase2_error: null, phase2_tx: null,
        gas_request_status: null, gas_requested_at: null, gas_tx: null,
        final_status: "pending",
      }).eq("run_id", runId).eq("owner_user_id", ownerId)
        .eq("final_status", "failed_gas").in("id", rows.map((r: { id: string }) => r.id));
      if (resetError) throw resetError;
      reset += rows.length;
    }
  } finally {
    // Even a partial reset must remain schedulable if a database request fails.
    const { error: releaseError } = await db.from("daily_claim_runs").update(reset ? {
      phase: "claiming", finished_at: null, phase1_done_at: null,
      gas_requests_done_at: null, retry_started_at: null, last_error: null,
      failed_gas: count - reset, final_failed: Math.max(0, run.final_failed - reset),
    } : { phase: "completed" }).eq("id", runId).eq("owner_user_id", ownerId).eq("phase", "preparing_retry");
    if (releaseError) throw releaseError;
  }
  return { runId, retried: reset };
}