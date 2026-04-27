import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ArrowLeft, Copy, Loader2, Play, Square, Sparkles, Trash2, Send,
  KeyRound, Wallet as WalletIcon, ExternalLink, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

type FarmerRow = {
  id: string;
  wallet_address: string;
  private_key: string;
  gd_status: string;
  gd_tx_hash: string | null;
  faucet_status: string;
  faucet_tx_hash: string | null;
  faucet_error: string | null;
  created_at: string;
};

type SweepResult = {
  wallet: string;
  ok: boolean;
  tx?: string;
  amount?: string;
  error?: string;
};

const FUNDER_KEY_STORAGE = "farmer_funder_key";
const G_AMOUNT_STORAGE = "farmer_g_amount";

type FarmerJob = {
  id: string;
  status: string;
  ok_count: number;
  failed_count: number;
  last_error: string | null;
  last_run_at: string | null;
  created_at: string;
};

export default function Farmer() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  // ----- Faucet Farmer state -----
  const [funderKey, setFunderKey] = useState("");
  const [gAmount, setGAmount] = useState("0.5");
  const [job, setJob] = useState<FarmerJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<FarmerRow[]>([]);

  // ----- Sweeper state -----
  const [sweepKeys, setSweepKeys] = useState("");
  const [receiver, setReceiver] = useState("");
  const [sweeping, setSweeping] = useState(false);
  const [sweepResults, setSweepResults] = useState<SweepResult[] | null>(null);
  const [sweepSummary, setSweepSummary] = useState<{ total: number; success: number; failed: number; total_swept_celo: string } | null>(null);
  const [sweepProgress, setSweepProgress] = useState<{ done: number; total: number; success: number; failed: number } | null>(null);
  const [activeSweepJobId, setActiveSweepJobId] = useState<string | null>(null);

  const running = job?.status === "running";

  // Restore from localStorage
  useEffect(() => {
    const k = localStorage.getItem(FUNDER_KEY_STORAGE);
    const a = localStorage.getItem(G_AMOUNT_STORAGE);
    if (k) setFunderKey(k);
    if (a) setGAmount(a);
  }, []);

  useEffect(() => {
    if (funderKey) localStorage.setItem(FUNDER_KEY_STORAGE, funderKey);
  }, [funderKey]);
  useEffect(() => {
    if (gAmount) localStorage.setItem(G_AMOUNT_STORAGE, gAmount);
  }, [gAmount]);

  const loadRows = async () => {
    if (!user) return;
    // Fetch ALL wallets in pages of 1000 (Supabase per-request cap)
    const PAGE = 1000;
    let from = 0;
    const all: FarmerRow[] = [];
    while (true) {
      const { data, error } = await supabase
        .from("farmer_wallets")
        .select("id, wallet_address, private_key, gd_status, gd_tx_hash, faucet_status, faucet_tx_hash, faucet_error, created_at")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) {
        toast({ title: "Could not load wallets", description: error.message, variant: "destructive" });
        return;
      }
      const batch = (data as FarmerRow[]) || [];
      all.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    setRows(all);
  };

  const loadJob = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("farmer_jobs")
      .select("id, status, ok_count, failed_count, last_error, last_run_at, created_at")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    setJob((data && data[0]) ? (data[0] as FarmerJob) : null);
  };

  useEffect(() => {
    if (user) {
      loadRows();
      loadJob();
    }
  }, [user]);

  // Poll job + rows while running so user sees progress in real time
  useEffect(() => {
    if (!user || !running) return;
    const t = window.setInterval(() => {
      loadJob();
      loadRows();
    }, 5000);
    return () => clearInterval(t);
  }, [user, running]);

  const start = async () => {
    if (!/^0x[a-fA-F0-9]{64}$/.test(funderKey.trim())) {
      toast({ title: "Invalid funder key", description: "Must be 0x + 64 hex characters", variant: "destructive" });
      return;
    }
    const amt = parseFloat(gAmount);
    if (!isFinite(amt) || amt <= 0) {
      toast({ title: "Invalid G$ amount", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      // Upsert: if a previous job row exists for this user, update it; else insert.
      let saved: FarmerJob | null = null;
      if (job) {
        const { data, error } = await supabase
          .from("farmer_jobs")
          .update({
            funder_key: funderKey.trim(),
            g_amount: gAmount.trim(),
            status: "running",
            last_error: null,
          })
          .eq("id", job.id)
          .select("id, status, ok_count, failed_count, last_error, last_run_at, created_at")
          .single();
        if (error) throw error;
        saved = data as FarmerJob;
      } else {
        const { data, error } = await supabase
          .from("farmer_jobs")
          .insert({
            owner_user_id: user!.id,
            funder_key: funderKey.trim(),
            g_amount: gAmount.trim(),
            status: "running",
          })
          .select("id, status, ok_count, failed_count, last_error, last_run_at, created_at")
          .single();
        if (error) throw error;
        saved = data as FarmerJob;
      }
      setJob(saved);

      // Kick the worker immediately so user doesn't wait for the next cron tick
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      fetch(`${SUPABASE_URL}/functions/v1/farmer-worker`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ trigger: "manual" }),
      }).catch(() => {});

      toast({ title: "Farming started", description: "Runs in background — you can close the app." });
    } catch (e: any) {
      toast({ title: "Could not start", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!job) return;
    setBusy(true);
    const { error } = await supabase
      .from("farmer_jobs")
      .update({ status: "stopped" })
      .eq("id", job.id);
    setBusy(false);
    if (error) {
      toast({ title: "Could not stop", description: error.message, variant: "destructive" });
      return;
    }
    setJob(j => j ? { ...j, status: "stopped" } : j);
    toast({ title: "Farming stopped" });
  };

  const copyAllKeys = () => {
    if (rows.length === 0) {
      toast({ title: "No keys to copy", variant: "destructive" });
      return;
    }
    const text = rows.map(r => r.private_key).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: `Copied ${rows.length} private key${rows.length === 1 ? "" : "s"}` });
  };

  const copyAllAddresses = () => {
    if (rows.length === 0) return;
    const text = rows.map(r => r.wallet_address).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: `Copied ${rows.length} address${rows.length === 1 ? "" : "es"}` });
  };

  const copyOne = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  };

  const deleteAll = async () => {
    if (rows.length === 0) return;
    if (!confirm(`Delete ALL ${rows.length} farmed wallets from your history? Make sure you have copied the keys first.`)) return;
    const { error } = await supabase
      .from("farmer_wallets")
      .delete()
      .eq("owner_user_id", user!.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setRows([]);
    toast({ title: "All wallets deleted" });
  };

  const deleteOne = async (id: string) => {
    if (!confirm("Delete this wallet from history?")) return;
    const { error } = await supabase.from("farmer_wallets").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setRows(prev => prev.filter(r => r.id !== id));
  };

  // ----- Sweeper (server-side, runs even if browser is closed) -----

  // Resume any running sweep job on mount, then keep polling
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const fetchActive = async () => {
      const { data } = await supabase
        .from("celo_sweep_jobs")
        .select("id, total, done, ok_count, failed_count, total_swept_celo, status, receiver")
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const j = data?.[0];
      if (!j) return;

      setActiveSweepJobId(j.id);
      setSweepProgress({
        done: j.done || 0,
        total: j.total || 0,
        success: j.ok_count || 0,
        failed: j.failed_count || 0,
      });
      if (j.status === "running") {
        setSweeping(true);
      } else {
        setSweeping(false);
        setSweepSummary({
          total: j.total || 0,
          success: j.ok_count || 0,
          failed: j.failed_count || 0,
          total_swept_celo: j.total_swept_celo || "0",
        });
      }
    };

    fetchActive();
    const iv = setInterval(fetchActive, 3000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user]);

  const runSweep = async () => {
    const keys = sweepKeys
      .split(/[\s,;\n]+/)
      .map(k => k.trim())
      .filter(k => /^0x[a-fA-F0-9]{64}$/.test(k));
    if (keys.length === 0) {
      toast({ title: "No valid private keys found", variant: "destructive" });
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(receiver.trim())) {
      toast({ title: "Invalid receiver address", variant: "destructive" });
      return;
    }
    if (!confirm(`Sweep CELO from ${keys.length} wallet${keys.length === 1 ? "" : "s"} to ${receiver.slice(0, 10)}…?\n\nThis runs on our servers — you can close the browser.`)) return;

    setSweeping(true);
    setSweepResults(null);
    setSweepSummary(null);
    setSweepProgress({ done: 0, total: keys.length, success: 0, failed: 0 });

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/celo-sweep-submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ keys, receiver: receiver.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        toast({ title: "Submit failed", description: json?.error || `HTTP ${res.status}`, variant: "destructive" });
        setSweeping(false);
        return;
      }
      setActiveSweepJobId(json.job_id);
      setSweepKeys("");
      toast({
        title: `Sweep started on server`,
        description: `${json.total} wallets queued. Safe to close the browser.`,
      });
    } catch (e: any) {
      toast({ title: "Network error", description: e?.message || String(e), variant: "destructive" });
      setSweeping(false);
    }
  };

  const stopSweep = async () => {
    if (!activeSweepJobId) return;
    if (!confirm("Stop the running sweep job? Pending wallets will not be swept.")) return;
    const { error } = await supabase
      .from("celo_sweep_jobs")
      .update({ status: "stopped", finished_at: new Date().toISOString() })
      .eq("id", activeSweepJobId);
    if (error) {
      toast({ title: "Stop failed", description: error.message, variant: "destructive" });
      return;
    }
    setSweeping(false);
    toast({ title: "Sweep stopped" });
  };

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>;
  }
  if (!user) return <Navigate to="/auth?next=/farmer" replace />;

  return (
    <div className="min-h-screen aurora-bg pb-12">
      <div className="container max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Home
          </Link>
          <Badge variant="outline" className="gap-1">
            <Sparkles className="size-3" /> Wallet Farmer
          </Badge>
        </div>

        <Tabs defaultValue="farmer" className="space-y-4">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="farmer">G$ Faucet Farmer</TabsTrigger>
            <TabsTrigger value="sweeper">CELO Sweeper</TabsTrigger>
          </TabsList>

          {/* ============ FARMER TAB ============ */}
          <TabsContent value="farmer" className="space-y-4">
            <Card className="glass-card-elevated">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <KeyRound className="size-5" /> Funder & loop settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Funder private key (Celo wallet holding G$)
                  </label>
                  <Input
                    type="password"
                    value={funderKey}
                    onChange={e => setFunderKey(e.target.value)}
                    placeholder="0x..."
                    className="font-mono text-xs"
                    disabled={running}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Stored only in your browser. Used to send G$ to each newly created wallet.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">G$ per wallet</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={gAmount}
                    onChange={e => setGAmount(e.target.value)}
                    disabled={running}
                  />
                </div>

                <div className="rounded-md bg-primary/5 border border-primary/20 p-2.5 text-[11px] text-muted-foreground">
                  Runs in the background on our servers. You can close the app or
                  switch off your phone — farming continues until you press Stop.
                </div>

                <div className="flex items-center gap-2">
                  {!running ? (
                    <Button onClick={start} disabled={busy} className="flex-1">
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                      Start farming
                    </Button>
                  ) : (
                    <Button onClick={stop} disabled={busy} variant="destructive" className="flex-1">
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
                      Stop
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => { loadJob(); loadRows(); }}>
                    <RefreshCw className="size-4" />
                  </Button>
                </div>

                {(job || rows.length > 0) && (
                  <div className="flex items-center gap-3 text-sm pt-2 border-t border-border flex-wrap">
                    {running && <span className="inline-flex items-center gap-1 text-primary">
                      <Loader2 className="size-3 animate-spin" /> Running…
                    </span>}
                    {!running && job && <span className="text-muted-foreground">Stopped</span>}
                    <span className="text-success">✓ {job?.ok_count ?? 0}</span>
                    <span className="text-destructive">✗ {job?.failed_count ?? 0}</span>
                    <span className="ml-auto text-muted-foreground">{rows.length} stored</span>
                  </div>
                )}
                {job?.last_error && !running && (
                  <p className="text-[11px] text-destructive/80 break-words">
                    Last error: {job.last_error}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base">Farmed wallets</CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={copyAllAddresses} disabled={rows.length === 0}>
                      <Copy className="size-3" /> Copy addresses
                    </Button>
                    <Button size="sm" variant="default" onClick={copyAllKeys} disabled={rows.length === 0}>
                      <Copy className="size-3" /> Copy all keys
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:text-destructive" onClick={deleteAll} disabled={rows.length === 0}>
                      <Trash2 className="size-3" /> Delete all
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <p className="text-sm text-center text-muted-foreground py-8">
                    No wallets yet. Set your funder key and press Start.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                    {rows.map(r => (
                      <div key={r.id} className="p-3 rounded-lg bg-muted/40 border border-border space-y-1.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <WalletIcon className="size-3.5 text-muted-foreground shrink-0" />
                            <span className="font-mono text-xs truncate">{r.wallet_address}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant={r.gd_status === "success" ? "default" : r.gd_status === "submitted" ? "secondary" : "destructive"} className="text-[10px]">
                              G$ {r.gd_status}
                            </Badge>
                            <Badge variant={r.faucet_status === "success" ? "default" : "destructive"} className="text-[10px]">
                              gas {r.faucet_status}
                            </Badge>
                          </div>
                        </div>
                        {r.faucet_error && (
                          <p className="text-[11px] text-destructive/80 break-words">{r.faucet_error}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <code className="flex-1 px-2 py-1 text-[11px] font-mono bg-background rounded border border-border truncate">
                            {r.private_key.slice(0, 12)}…{r.private_key.slice(-10)}
                          </code>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => copyOne(r.private_key, "Private key")}>
                            <Copy className="size-3" />
                          </Button>
                          <a
                            href={`https://celoscan.io/address/${r.wallet_address}`}
                            target="_blank" rel="noreferrer"
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent border border-border"
                          >
                            <ExternalLink className="size-3" />
                          </a>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteOne(r.id)}>
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============ SWEEPER TAB ============ */}
          <TabsContent value="sweeper" className="space-y-4">
            <Card className="glass-card-elevated">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Send className="size-5" /> Batch sweep CELO
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Receiver address
                  </label>
                  <Input
                    value={receiver}
                    onChange={e => setReceiver(e.target.value)}
                    placeholder="0x..."
                    className="font-mono text-xs"
                    disabled={sweeping}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Private keys (one per line — unlimited, processed in parallel batches of 50)
                  </label>
                  <Textarea
                    value={sweepKeys}
                    onChange={e => setSweepKeys(e.target.value)}
                    placeholder="0xabc...&#10;0xdef...&#10;0x123..."
                    rows={8}
                    className="font-mono text-xs"
                    disabled={sweeping}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Keys are not saved. Each wallet's CELO balance (minus gas) will be sent to the receiver.
                  </p>
                </div>
                <Button onClick={runSweep} disabled={sweeping} className="w-full">
                  {sweeping ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {sweeping ? "Sweeping…" : "Run sweep"}
                </Button>

                {sweepProgress && sweeping && (
                  <div className="mt-2 p-3 rounded bg-muted/40 border border-border">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-muted-foreground">Live progress</span>
                      <span className="font-mono">{sweepProgress.done} / {sweepProgress.total}</span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${sweepProgress.total ? (sweepProgress.done / sweepProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                      <div>
                        <p className="text-sm font-bold text-success">{sweepProgress.success}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">done</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-destructive">{sweepProgress.failed}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">failed</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold">{sweepProgress.total - sweepProgress.done}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">left</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {sweepSummary && (
              <Card className="glass-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Sweep result</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                    <div className="p-2 rounded bg-muted/40 border border-border">
                      <p className="text-lg font-bold text-success">{sweepSummary.success}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">success</p>
                    </div>
                    <div className="p-2 rounded bg-muted/40 border border-border">
                      <p className="text-lg font-bold text-destructive">{sweepSummary.failed}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">failed</p>
                    </div>
                    <div className="p-2 rounded bg-muted/40 border border-border">
                      <p className="text-lg font-bold">{Number(sweepSummary.total_swept_celo).toFixed(4)}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">CELO sent</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                    {(sweepResults || []).map((r, i) => (
                      <div key={i} className="p-2 rounded bg-muted/40 border border-border text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono truncate">{r.wallet}</span>
                          {r.ok ? (
                            <Badge variant="default" className="text-[10px]">{Number(r.amount).toFixed(4)} CELO</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">failed</Badge>
                          )}
                        </div>
                        {r.tx && (
                          <a href={`https://celoscan.io/tx/${r.tx}`} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 mt-1">
                            <ExternalLink className="size-3" /> tx
                          </a>
                        )}
                        {r.error && <p className="text-[11px] text-destructive/80 mt-1 break-words">{r.error}</p>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
