import { createServerFn } from "@tanstack/react-start";
import { computeAddress } from "ethers";

function checkPw(pw: string) {
  const real = process.env["ADMIN_PASSWORD"]?.trim();
  if (!real || pw.trim() !== real) throw new Error("Invalid admin password");
}

export const adminListGroups = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => d)
  .handler(async ({ data }) => {
    checkPw(data.password);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: groups, error } = await admin
      .from("daily_claim_groups")
      .select("id, owner_user_id, name, network")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = {};
    for (let from = 0; ; from += 1000) {
      const { data: rows, error: e } = await admin.from("daily_claim_wallets").select("group_id").range(from, from + 999);
      if (e) throw new Error(e.message);
      for (const r of rows || []) if (r.group_id) counts[r.group_id] = (counts[r.group_id] || 0) + 1;
      if (!rows || rows.length < 1000) break;
    }
    const ownerIds = [...new Set((groups || []).map((g) => g.owner_user_id))];
    const { data: profs } = ownerIds.length
      ? await admin.from("profiles").select("id, email, display_name, wallet_address").in("id", ownerIds)
      : { data: [] };
    const pmap = new Map((profs || []).map((p) => [p.id, p]));
    return ownerIds.map((id) => {
      const p = pmap.get(id);
      return {
        user_id: id,
        label: p?.email || p?.display_name || p?.wallet_address || id.slice(0, 8),
        groups: (groups || [])
          .filter((g) => g.owner_user_id === id)
          .map((g) => ({ id: g.id, name: g.name, network: g.network, key_count: counts[g.id] || 0 })),
      };
    });
  });

export const adminCheckKeys = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string; group_id: string; items: string[] }) => d)
  .handler(async ({ data }) => {
    checkPw(data.password);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const addrs = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data: rows, error } = await admin
        .from("daily_claim_wallets").select("wallet_address").eq("group_id", data.group_id).range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of rows || []) addrs.add(String(r.wallet_address).toLowerCase());
      if (!rows || rows.length < 1000) break;
    }
    return data.items.slice(0, 5000).map((raw) => {
      const v = String(raw).trim();
      let address: string | null = null;
      if (/^0x[a-fA-F0-9]{40}$/.test(v)) address = v;
      else {
        const pk = v.startsWith("0x") ? v : "0x" + v;
        if (/^0x[a-fA-F0-9]{64}$/.test(pk)) { try { address = computeAddress(pk); } catch { /* invalid */ } }
      }
      const status: "found" | "missing" | "invalid" = !address ? "invalid" : addrs.has(address.toLowerCase()) ? "found" : "missing";
      return { input: v.slice(0, 12), address, status };
    });
  });
