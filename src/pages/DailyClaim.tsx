import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeOff, Trash2, Copy, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type SavedWallet = { id: string; wallet_address: string; label: string | null; is_active: boolean; created_at: string };
type RunItem = {
  wallet_address: string;
  phase1_status: string;
  phase1_error: string | null;
  gas_request_status: string | null;
  phase2_status: string | null;
  phase2_error: string | null;
  final_status: string;
};
type Run = {
  id: string;
  run_date: string;
  phase: string;
  total: number;
  success: number;
  failed_gas: number;
  failed_other: number;
  final_failed: number;
  started_at: string;
  phase1_done_at: string | null;
  gas_requests_done_at: string | null;
  retry_started_at: string | null;
  finished_at: string | null;
};
type FailedKey = { wallet_address: string; private_key: string; status: string; error?: string };

function shortAddr(a: string) {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function phaseLabel(p: string | undefined) {
  switch (p) {
    case "claiming": return "Claiming";
    case "gas_requesting": return "Requesting gas";
    case "waiting_30m": return "Waiting 30 min for gas";
    case "retrying": return "Retrying";
    case "completed": return "Completed";
    default: return "Not started";
  }
}

function statusColor(s?: string) {
  if (s === "success") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (s === "failed_gas") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (s === "failed_kyc") return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  if (s === "failed_other") return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  if (s === "already_claimed") return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  return "bg-muted text-muted-foreground border-border";
}

export default function DailyClaim() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<SavedWallet[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [items, setItems] = useState<RunItem[]>([]);
  const [failedKeys, setFailedKeys] = useState<FailedKey[]>([]);
  const [walletCount, setWalletCount] = useState(0);
  const [serverNow, setServerNow] = useState<string>("");
  const [pasteText, setPasteText] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [shownKeys, setShownKeys] = useState<Record<string, boolean>>({});
  const [showFailedBox, setShowFailedBox] = useState(true);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/auth");
  }, [user, loading, navigate]);

  async function fetchAll() {
    if (!user) return;
    setRefreshing(true);
    try {
      const [walletsRes, statusRes] = await Promise.all([
        supabase.functions.invoke("daily-claim-wallets"),
        supabase.functions.invoke("daily-claim-status"),
      ]);
      if (walletsRes.data?.wallets) setWallets(walletsRes.data.wallets);
      if (statusRes.data) {
        setRun(statusRes.data.run);
        setItems(statusRes.data.items || []);
        setFailedKeys(statusRes.data.failed_keys || []);
        setWalletCount(statusRes.data.wallet_count || 0);
        setServerNow(statusRes.data.server_time || "");
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    fetchAll();
    pollRef.current = window.setInterval(fetchAll, 8000) as unknown as number;
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function addKeys() {
    const lines = pasteText.split(/\s+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast({ title: "Paste at least one private key" });
      return;
    }
    setAdding(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-claim-wallets?action=add", {
        body: { private_keys: lines },
      });
      if (error) throw error;
      toast({
        title: `Added ${data?.added ?? 0} wallets`,
        description: data?.invalid ? `${data.invalid} invalid keys skipped` : undefined,
      });
      setPasteText("");
      fetchAll();
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function removeWallet(id: string) {
    await supabase.functions.invoke("daily-claim-wallets?action=delete", { body: { id } });
    fetchAll();
  }

  async function toggleActive(id: string, is_active: boolean) {
    await supabase.functions.invoke("daily-claim-wallets?action=toggle", { body: { id, is_active } });
    fetchAll();
  }

  async function deleteAll() {
    if (!confirm("Remove ALL saved wallets?")) return;
    await supabase.functions.invoke("daily-claim-wallets?action=delete", { body: { all: true } });
    fetchAll();
  }

  function copy(text: string, label = "Copied") {
    navigator.clipboard.writeText(text).then(() => toast({ title: label }));
  }

  function copyAllFailed() {
    if (failedKeys.length === 0) return;
    const txt = failedKeys.map((k) => k.private_key).join("\n");
    copy(txt, `Copied ${failedKeys.length} failed keys`);
  }

  // Time until next BD midnight (UTC 18:00)
  const countdown = useMemo(() => {
    const now = new Date(serverNow || Date.now());
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(18);
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    const diff = next.getTime() - now.getTime();
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }, [serverNow]);

  const waitRemainingMin = useMemo(() => {
    if (!run || run.phase !== "waiting_30m" || !run.gas_requests_done_at) return null;
    const endsAt = new Date(run.gas_requests_done_at).getTime() + 30 * 60_000;
    const left = Math.max(0, endsAt - Date.now());
    return Math.ceil(left / 60_000);
  }, [run]);

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
            <h1 className="text-2xl font-bold mt-1">Daily Auto-Claim</h1>
            <p className="text-sm text-muted-foreground">
              Runs automatically every day at <span className="text-foreground font-medium">12:00 AM Bangladesh time</span> ·
              Next start in <span className="text-foreground font-medium">{countdown}</span>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </header>

        {/* Today's run */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span>Today's Run</span>
              <Badge variant="outline">{phaseLabel(run?.phase)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!run ? (
              <p className="text-sm text-muted-foreground">
                No run yet today. {walletCount} active wallet{walletCount === 1 ? "" : "s"} ready for next auto-claim.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                  <Stat label="Total" value={run.total} />
                  <Stat label="Success" value={run.success} tone="text-emerald-400" />
                  <Stat label="Need Gas" value={run.failed_gas} tone="text-amber-400" />
                  <Stat label="Other Fail" value={run.failed_other} tone="text-rose-400" />
                  <Stat label="Final Failed" value={run.final_failed} tone="text-rose-400" />
                </div>
                {run.phase === "waiting_30m" && waitRemainingMin !== null && (
                  <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm">
                    Waiting for gas to arrive — retry will start in <b>{waitRemainingMin} min</b>.
                  </div>
                )}
                {run.phase === "completed" && (
                  <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-sm">
                    Today's run completed. {run.final_failed} wallet{run.final_failed === 1 ? "" : "s"} could not be claimed.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Failed keys box */}
        {failedKeys.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between">
                <button onClick={() => setShowFailedBox(!showFailedBox)} className="flex items-center gap-2 text-left">
                  Failed Wallets ({failedKeys.length})
                  {showFailedBox ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <Button size="sm" onClick={copyAllFailed}>
                  <Copy className="w-4 h-4 mr-2" /> Copy All Keys
                </Button>
              </CardTitle>
            </CardHeader>
            {showFailedBox && (
              <CardContent>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {failedKeys.map((k) => (
                    <div key={k.wallet_address} className="p-2 rounded-md bg-muted/40 border border-border">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-mono text-xs">{shortAddr(k.wallet_address)}</span>
                        <Badge variant="outline" className={statusColor(k.status)}>{k.status}</Badge>
                        <div className="flex gap-1 ml-auto">
                          <Button size="sm" variant="ghost" onClick={() => setShownKeys((s) => ({ ...s, [k.wallet_address]: !s[k.wallet_address] }))}>
                            {shownKeys[k.wallet_address] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => copy(k.private_key, "Key copied")}>
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      {shownKeys[k.wallet_address] && (
                        <code className="block mt-2 text-xs break-all font-mono text-muted-foreground">{k.private_key}</code>
                      )}
                      {k.error && <p className="text-xs text-rose-400 mt-1">{k.error}</p>}
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Saved wallets */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span>Saved Wallets ({wallets.length})</span>
              {wallets.length > 0 && (
                <Button size="sm" variant="outline" onClick={deleteAll}>Remove all</Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Textarea
                rows={5}
                placeholder="Paste private keys here (one per line) — they will be encrypted and saved to your account"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                className="font-mono text-xs"
              />
              <Button onClick={addKeys} disabled={adding} className="mt-2 w-full sm:w-auto">
                {adding ? "Adding…" : "Add Wallets"}
              </Button>
            </div>

            {wallets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No saved wallets yet.</p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {wallets.map((w) => (
                  <div key={w.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/40">
                    <span className="font-mono text-xs flex-1">{shortAddr(w.wallet_address)}</span>
                    <Switch checked={w.is_active} onCheckedChange={(v) => toggleActive(w.id, v)} />
                    <Button size="sm" variant="ghost" onClick={() => removeWallet(w.id)}>
                      <Trash2 className="w-4 h-4 text-rose-400" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-wallet status table */}
        {items.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Per-Wallet Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 max-h-96 overflow-y-auto text-xs">
                {items.map((it) => (
                  <div key={it.wallet_address} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/40">
                    <span className="font-mono flex-1">{shortAddr(it.wallet_address)}</span>
                    <Badge variant="outline" className={statusColor(it.phase1_status)}>P1: {it.phase1_status}</Badge>
                    {it.gas_request_status && (
                      <Badge variant="outline" className="text-[10px]">gas: {it.gas_request_status}</Badge>
                    )}
                    {it.phase2_status && (
                      <Badge variant="outline" className={statusColor(it.phase2_status)}>P2: {it.phase2_status}</Badge>
                    )}
                    <Badge variant="outline" className={statusColor(it.final_status)}>{it.final_status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="p-2 rounded-md bg-muted/40 border border-border">
      <div className={`text-xl font-bold ${tone || ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
