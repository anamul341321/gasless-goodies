import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { prepareGasRetry } from "./daily-claim-retry";

export const retryDailyGasFailures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) => {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.runId)) {
      throw new Error("Invalid batch");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    // Verify ownership through the user's RLS client before privileged writes.
    const { data: owned, error } = await context.supabase.from("daily_claim_runs")
      .select("id").eq("id", data.runId).eq("owner_user_id", context.userId).maybeSingle();
    if (error || !owned) throw new Error("Batch not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await prepareGasRetry(supabaseAdmin, data.runId, context.userId);
    // The existing minute scheduler also resumes this run if the kick fails.
    await supabaseAdmin.functions.invoke("daily-claim-worker", {
      body: { run_id: result.runId },
    }).catch(() => undefined);
    return result;
  });