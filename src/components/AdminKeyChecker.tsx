import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Search, Users, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { adminListGroups, adminCheckKeys } from "@/lib/adminKeys.functions";

type Group = { id: string; name: string; network: string; key_count: number };
type UserRow = { user_id: string; label: string; groups: Group[] };
type Result = { input: string; address: string | null; status: "found" | "missing" | "invalid" };

export default function AdminKeyChecker({ password }: { password: string }) {
  const listFn = useServerFn(adminListGroups);
  const checkFn = useServerFn(adminCheckKeys);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  const load = async () => {
    setLoading(true);
    try { setUsers(await listFn({ data: { password } })); } catch (e: any) { toast.error(e?.message || "Failed"); }
    setLoading(false);
  };

  const check = async () => {
    const items = text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!selected || items.length === 0) { toast.error("Select a group and paste keys"); return; }
    setChecking(true);
    try { setResults(await checkFn({ data: { password, group_id: selected, items } })); } catch (e: any) { toast.error(e?.message || "Failed"); }
    setChecking(false);
  };

  const count = (s: Result["status"]) => results?.filter((r) => r.status === s).length ?? 0;

  return (
    <div className="glass-card rounded-2xl p-5 space-y-4 animate-slide-up">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
          <Users className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-foreground">User Groups & Key Checker</p>
          <p className="text-xs text-muted-foreground">See each user's group key count and check whether your keys are in a group.</p>
        </div>
      </div>
      <Button onClick={load} disabled={loading} className="w-full rounded-2xl">
        {loading ? "Loading..." : users ? "Refresh" : "Load User Groups"}
      </Button>

      {users && users.length === 0 && <p className="text-sm text-muted-foreground text-center">No groups found.</p>}
      {users?.map((u) => (
        <div key={u.user_id} className="rounded-xl border border-border/60 p-3 space-y-2">
          <p className="text-sm font-semibold text-foreground break-all">{u.label}</p>
          {u.groups.map((g) => (
            <button
              key={g.id}
              onClick={() => { setSelected(g.id); setResults(null); }}
              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${selected === g.id ? "bg-primary/15 ring-1 ring-primary" : "bg-muted/40 hover:bg-muted"}`}
            >
              <span className="min-w-0 truncate">{g.name} <span className="text-xs text-muted-foreground uppercase">· {g.network}</span></span>
              <span className="font-bold text-primary shrink-0">{g.key_count} keys</span>
            </button>
          ))}
        </div>
      ))}

      {selected && (
        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste private keys or wallet addresses (one per line)"
            className="min-h-[120px] font-mono text-xs"
          />
          <Button onClick={check} disabled={checking} className="w-full rounded-2xl gap-2">
            <Search className="h-4 w-4" /> {checking ? "Checking..." : "Check in Selected Group"}
          </Button>
        </div>
      )}

      {results && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-success/15 p-2"><p className="text-lg font-bold text-success">{count("found")}</p>Found</div>
            <div className="rounded-lg bg-destructive/15 p-2"><p className="text-lg font-bold text-destructive">{count("missing")}</p>Not found</div>
            <div className="rounded-lg bg-muted p-2"><p className="text-lg font-bold">{count("invalid")}</p>Invalid</div>
          </div>
          <div className="max-h-72 overflow-auto space-y-1">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs font-mono">
                {r.status === "found" ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : r.status === "missing" ? <XCircle className="h-4 w-4 text-destructive shrink-0" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />}
                <span className="break-all">{r.address || r.input + "…"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
