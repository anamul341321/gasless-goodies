// Resolve ownership from a verified session, never a supplied user ID or wallet.
export async function historyUser(req: Request): Promise<{ id: string } | null> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return null;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: authorization, apikey: key } });
    if (!res.ok) return null;
    const user = await res.json();
    return typeof user?.id === "string" ? { id: user.id } : null;
  } catch { return null; }
}

export function ownsHistory(owner: string | null | undefined, requester: string | null | undefined): boolean {
  return !!owner && !!requester && owner === requester;
}

export async function ownsJob(req: Request, table: string, jobId: string): Promise<boolean> {
  const user = await historyUser(req);
  if (!user || !/^[0-9a-f-]{36}$/i.test(jobId)) return false;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return false;
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${jobId}&owner_user_id=eq.${user.id}&select=owner_user_id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && ownsHistory(rows[0]?.owner_user_id, user.id);
}

export function historyDenied(cors: Record<string, string>, status = 401): Response {
  return new Response(JSON.stringify({ error: status === 401 ? "Sign in required" : "History unavailable" }), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}