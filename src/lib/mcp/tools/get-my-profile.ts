import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_my_profile",
  title: "Get my profile",
  description: "Return the signed-in user's profile (name, email, linked wallet).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { data, error } = await supabaseForUser(ctx)
      .from("profiles")
      .select("display_name, email, wallet_address, auth_method")
      .eq("id", ctx.getUserId()!)
      .maybeSingle();
    if (error) throw new ToolError(error.message);
    if (!data) return { content: [{ type: "text", text: "No profile found." }] };
    const profile = {
      display_name: data.display_name,
      email: data.email,
      wallet_address: data.wallet_address,
      auth_method: data.auth_method,
    };
    return { content: [{ type: "text", text: JSON.stringify(profile) }], structuredContent: { profile } };
  },
});
