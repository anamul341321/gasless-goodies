import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_claim_groups",
  title: "List my daily claim groups",
  description: "List the signed-in user's Daily Auto Claim groups with their network, schedule (Bangladesh time) and status.",
  inputSchema: {
    network: z.enum(["celo", "xdc"]).optional().describe("Only show groups on this network."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ network }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    let q = supabaseForUser(ctx)
      .from("daily_claim_groups")
      .select("id, name, network, enabled, start_hour_bd, start_minute_bd, retry_wait_minutes")
      .order("created_at", { ascending: true });
    if (network) q = q.eq("network", network);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const groups = (data ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      network: g.network,
      enabled: g.enabled,
      start_time_bd: `${String(g.start_hour_bd).padStart(2, "0")}:${String(g.start_minute_bd).padStart(2, "0")}`,
      retry_wait_minutes: g.retry_wait_minutes,
    }));
    const text = groups.length
      ? groups.map((g) => `${g.name} [${g.network}] ${g.start_time_bd} BD ${g.enabled ? "on" : "off"}`).join("\n")
      : "No claim groups.";
    return { content: [{ type: "text", text }], structuredContent: { groups } };
  },
});
