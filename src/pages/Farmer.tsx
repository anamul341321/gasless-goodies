import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ArrowLeft, Loader2, Square, Sparkles, Send, ExternalLink, Search, Wallet as WalletIcon, Copy, Gift, Fuel,
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
import GasLoader from "./GasLoader";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

type SweepResult = {
  wallet: string;
  ok: boolean;
  tx?: string;
  amount?: string;
  error?: string;
};

export default function Farmer() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  // ----- Sweeper state -----
  const [sweepKeys, setSweepKeys] = useState("");
  const [receiver, setReceiver] = useState("");
  const [sweeping, setSweeping] = useState(false);
  const [sweepResults, setSweepResults] = useState<SweepResult[] | null>(null);
  const [sweepSummary, setSweepSummary] = useState<{ total: number; success: number; failed: number; total_swept_celo: string } | null>(null);
  const [sweepProgress, setSweepProgress] = useState<{ done: number; total: number; success: number; failed: number } | null>(null);
  const [activeSweepJobId, setActiveSweepJobId] = useState<string | null>(null);

  // ----- Balance checker state -----
  const [checkInput, setCheckInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResults, setCheckResults] = useState<{
    total_celo: number; ok: number; errors: number;
    results: { input: string; address?: string; balance?: string; error?: string }[];
  } | null>(null);

  const runBalanceCheck = async () => {
    const inputs = checkInput.split(/[\s,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (inputs.length === 0) {
      toast({ title: "Paste at least one address or private key", variant: "destructive" });
      return;
    }
    if (inputs.length > 1000) {
      toast({ title: "Max 1000 entries per check", variant: "destructive" });
      return;
    }
    setChecking(true);
    setCheckResults(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/celo-balance-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ inputs }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "Check failed", description: json?.error || `HTTP ${res.status}`, variant: "destructive" });
      } else {
        setCheckResults(json);
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  const copyAddresses = async () => {
    if (!checkResults) return;
    const addrs = checkResults.results.filter(r => r.address).map(r => r.address).join("\n");
    await navigator.clipboard.writeText(addrs);
    toast({ title: "Addresses copied" });
  };

  // ----- Bulk Send G$ state (async job system) -----
  const [bulkSenderKey, setBulkSenderKey] = useState("");
  const [bulkRecipients, setBulkRecipients] = useState("");
  const [bulkAmount, setBulkAmount] = useState("0.5");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [bulkJobId, setBulkJobId] = useState<string | null>(() => {
    try { return localStorage.getItem("gd_bulk_job_id"); } catch { return null; }
  });
  const [bulkJob, setBulkJob] = useState<any>(null);
  const [bulkRecipientsStatus, setBulkRecipientsStatus] = useState<any[]>([]);

  // Poll job status — only depends on bulkJobId; uses local var for stop condition
  useEffect(() => {
    if (!bulkJobId) return;
    let cancelled = false;
    let stopped = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/gd-bulk-status?job_id=${bulkJobId}`,
          { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string } }
        );
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json?.ok) {
          setBulkJob(json.job);
          setBulkRecipientsStatus(json.recipients || []);
          const s = json.job?.status;
          if (s === "completed" || s === "failed" || s === "stopped") {
            stopped = true;
          }
        }
      } catch {}
    };
    fetchStatus();
    const iv = setInterval(() => {
      if (stopped) return;
      fetchStatus();
    }, 4000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [bulkJobId]);

  const clearBulkJob = () => {
    setBulkJobId(null);
    setBulkJob(null);
    setBulkRecipientsStatus([]);
    try { localStorage.removeItem("gd_bulk_job_id"); } catch {}
  };

  const cancelBulkJob = async () => {
    if (!bulkJobId || bulkCancelling) return;
    if (!confirm("Stop this bulk send job? Pending wallets will be skipped; any transaction already submitted on-chain cannot be cancelled.")) return;
    setBulkCancelling(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-bulk-cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ job_id: bulkJobId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "Cancel failed", description: json?.error || `HTTP ${res.status}`, variant: "destructive" });
      } else {
        toast({ title: "Bulk send stopped", description: `${json.skipped || 0} pending wallets skipped.` });
        setBulkJob((prev: any) => prev ? { ...prev, status: "stopped", skipped: json.skipped, sent: json.sent, failed: json.failed, last_error: "Cancelled by user" } : prev);
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBulkCancelling(false);
    }
  };

  const runBulkSend = async () => {
    let key = bulkSenderKey.trim();
    if (/^[a-fA-F0-9]{64}$/.test(key)) key = "0x" + key;
    if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
      toast({ title: "Invalid sender private key", variant: "destructive" });
      return;
    }
    const recipients = bulkRecipients
      .split(/[\s,;\n]+/)
      .map(r => r.trim())
      .filter(r => /^0x[a-fA-F0-9]{40}$/.test(r));
    if (recipients.length === 0) {
      toast({ title: "No valid recipient addresses", variant: "destructive" });
      return;
    }
    if (recipients.length > 5000) {
      toast({ title: "Max 5000 recipients per request", variant: "destructive" });
      return;
    }
    const amt = Number(bulkAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    const total = (amt * recipients.length).toFixed(4);
    if (!confirm(`Send ${amt} G$ to ${recipients.length} wallets?\n\nTotal: ${total} G$\n\nRuns on our servers — safe to close the browser.`)) return;

    setBulkSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-bulk-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ sender_key: key, recipients, amount: bulkAmount }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "Submit failed", description: json?.error || `HTTP ${res.status}`, variant: "destructive" });
      } else {
        try { localStorage.setItem("gd_bulk_job_id", json.job_id); } catch {}
        setBulkJobId(json.job_id);
        setBulkJob(null);
        setBulkRecipientsStatus([]);
        setBulkSenderKey("");
        toast({
          title: "Bulk send started on server",
          description: json.message || `${json.total} queued. Safe to close browser.`,
        });
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBulkSubmitting(false);
    }
  };


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

        <Tabs defaultValue="bulksend" className="space-y-4">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="gasloader">Gas Loader</TabsTrigger>
            <TabsTrigger value="bulksend">Bulk Send</TabsTrigger>
            <TabsTrigger value="sweeper">Sweeper</TabsTrigger>
            <TabsTrigger value="check">Balance</TabsTrigger>
          </TabsList>

          {/* ============ GAS LOADER (embedded) ============ */}
          <TabsContent value="gasloader" className="space-y-4">
            <div className="-mx-4">
              <GasLoader />
            </div>
          </TabsContent>

          {/* ============ BULK SEND G$ TAB ============ */}
          <TabsContent value="bulksend" className="space-y-4">
            <Card className="glass-card-elevated">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Gift className="size-5" /> Bulk Send G$ (one transaction)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Send G$ from one wallet to many recipients using the audited
                  Disperse contract. Large lists are auto-split into safe batches.
                </p>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Sender private key (must hold G$ + a little CELO for gas)
                  </label>
                  <Input
                    type="password"
                    value={bulkSenderKey}
                    onChange={e => setBulkSenderKey(e.target.value)}
                    placeholder="0x..."
                    className="font-mono text-xs"
                    disabled={bulkSubmitting}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Amount of G$ per recipient
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={bulkAmount}
                    onChange={e => setBulkAmount(e.target.value)}
                    className="font-mono text-xs"
                    disabled={bulkSubmitting}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Recipient addresses (one per line)
                  </label>
                  <Textarea
                    value={bulkRecipients}
                    onChange={e => setBulkRecipients(e.target.value)}
                    placeholder="0xabc...&#10;0xdef...&#10;0x123..."
                    rows={8}
                    className="font-mono text-xs"
                    disabled={bulkSubmitting}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {(() => {
                      const count = bulkRecipients
                        .split(/[\s,;\n]+/)
                        .map(r => r.trim())
                        .filter(r => /^0x[a-fA-F0-9]{40}$/.test(r)).length;
                      const amt = Number(bulkAmount) || 0;
                      return `${count} valid recipient${count === 1 ? "" : "s"} · total ${(count * amt).toFixed(4)} G$`;
                    })()}
                  </p>
                </div>

                <Button onClick={runBulkSend} disabled={bulkSubmitting} className="w-full">
                  {bulkSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />}
                  {bulkSubmitting ? "Submitting…" : "Run bulk send"}
                </Button>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Runs on our servers. Safe to close the browser.
                </p>

                {bulkJobId && bulkJob && (
                  <div className="space-y-3 pt-3 border-t border-border">
                    <div className="flex items-center justify-between">
                      <div className="text-xs">
                        <span className="text-muted-foreground">Job: </span>
                        <span className="font-mono">{String(bulkJobId).slice(0, 8)}…</span>
                        <Badge
                          variant={
                            bulkJob.status === "completed" ? "default"
                            : bulkJob.status === "failed" ? "destructive"
                            : "secondary"
                          }
                          className="ml-2 text-[10px]"
                        >
                          {bulkJob.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {(bulkJob.status === "pending" || bulkJob.status === "processing") && (
                          <Button size="sm" variant="destructive" onClick={cancelBulkJob} disabled={bulkCancelling}>
                            {bulkCancelling ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
                            Stop
                          </Button>
                        )}
                        {(bulkJob.status === "completed" || bulkJob.status === "failed" || bulkJob.status === "stopped") && (
                          <Button size="sm" variant="ghost" onClick={clearBulkJob}>
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="p-2 rounded bg-muted/40 border border-border">
                        <p className="text-lg font-bold">{bulkJob.total}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">total</p>
                      </div>
                      <div className="p-2 rounded bg-primary/10 border border-primary/20">
                        <p className="text-lg font-bold text-primary">{bulkJob.sent}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">sent</p>
                      </div>
                      <div className="p-2 rounded bg-destructive/10 border border-destructive/20">
                        <p className="text-lg font-bold text-destructive">{bulkJob.failed}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">failed</p>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border border-border">
                        <p className="text-lg font-bold">{bulkJob.skipped || 0}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">skipped</p>
                      </div>
                    </div>

                    {bulkJob.last_error && (
                      <div className="p-2 rounded bg-destructive/10 border border-destructive/20 text-[11px] text-destructive break-words">
                        {bulkJob.last_error}
                      </div>
                    )}

                    {bulkJob.approve_tx && (
                      <div className="p-2 rounded bg-muted/40 border border-border text-xs">
                        <span className="text-muted-foreground">Approve tx: </span>
                        <a
                          href={`https://celoscan.io/tx/${bulkJob.approve_tx}`}
                          target="_blank" rel="noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <ExternalLink className="size-3" /> view
                        </a>
                      </div>
                    )}

                    {bulkRecipientsStatus.length > 0 && (
                      <div className="space-y-1 max-h-72 overflow-y-auto">
                        {bulkRecipientsStatus.slice(0, 200).map((r, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/30 text-[11px] font-mono">
                            <span className="truncate">{r.wallet_address.slice(0, 10)}…{r.wallet_address.slice(-6)}</span>
                            {r.status === "sent" && r.tx_hash ? (
                              <a
                                href={`https://celoscan.io/tx/${r.tx_hash}`}
                                target="_blank" rel="noreferrer"
                                className="text-primary hover:underline inline-flex items-center gap-1 flex-shrink-0"
                              >
                                <ExternalLink className="size-3" /> sent
                              </a>
                            ) : r.status === "failed" ? (
                              <Badge variant="destructive" className="text-[10px]">failed</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                            )}
                          </div>
                        ))}
                        {bulkRecipientsStatus.length > 200 && (
                          <p className="text-[10px] text-muted-foreground text-center pt-1">
                            Showing first 200 of {bulkRecipientsStatus.length}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

              </CardContent>
            </Card>
          </TabsContent>


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
                <div className="flex gap-2">
                  <Button onClick={runSweep} disabled={sweeping} className="flex-1">
                    {sweeping ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    {sweeping ? "Sweeping on server…" : "Run sweep"}
                  </Button>
                  {sweeping && activeSweepJobId && (
                    <Button onClick={stopSweep} variant="destructive">
                      <Square className="size-4" /> Stop
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Runs in the background on our servers — safe to close the browser.
                </p>

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

          {/* ============ BALANCE CHECK TAB ============ */}
          <TabsContent value="check" className="space-y-4">
            <Card className="glass-card-elevated">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Search className="size-5" /> Wallet CELO balance check
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Paste addresses or private keys (one per line — up to 1000, processed in parallel batches of 100)
                  </label>
                  <Textarea
                    value={checkInput}
                    onChange={e => setCheckInput(e.target.value)}
                    placeholder="0xabc... (address)&#10;0xdef... (private key)&#10;..."
                    rows={8}
                    className="font-mono text-xs"
                    disabled={checking}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Both wallet addresses (40 hex) and private keys (64 hex) are accepted. Keys are not saved.
                  </p>
                </div>
                <Button onClick={runBalanceCheck} disabled={checking} className="w-full">
                  {checking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  {checking ? "Checking…" : "Check balances"}
                </Button>

                {checkResults && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded bg-primary/10 border border-primary/20">
                        <p className="text-lg font-bold text-primary">
                          {checkResults.total_celo.toFixed(4)}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase">Total CELO</p>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border border-border">
                        <p className="text-lg font-bold text-success">{checkResults.ok}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Wallets</p>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border border-border">
                        <p className="text-lg font-bold text-destructive">{checkResults.errors}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Errors</p>
                      </div>
                    </div>

                    <Button onClick={copyAddresses} variant="outline" size="sm" className="w-full">
                      <Copy className="size-3.5" /> Copy all addresses
                    </Button>

                    <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                      {checkResults.results.map((r, i) => (
                        <div key={i} className="p-2 rounded bg-muted/40 border border-border text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono truncate flex items-center gap-1.5">
                              <WalletIcon className="size-3 text-muted-foreground shrink-0" />
                              {r.address || r.input.slice(0, 14) + "…"}
                            </span>
                            {r.balance !== undefined ? (
                              <Badge variant="default" className="text-[10px] shrink-0">
                                {Number(r.balance).toFixed(4)} CELO
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px] shrink-0">
                                {r.error || "error"}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
