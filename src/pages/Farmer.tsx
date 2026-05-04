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

  // ----- Bulk Send G$ state -----
  const [bulkSenderKey, setBulkSenderKey] = useState("");
  const [bulkRecipients, setBulkRecipients] = useState("");
  const [bulkAmount, setBulkAmount] = useState("0.5");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    ok: boolean;
    approve_tx?: string;
    total_sent: string;
    recipient_count: number;
    batches: { tx?: string; recipients: number; error?: string }[];
  } | null>(null);

  const runBulkSend = async () => {
    let key = bulkSenderKey.trim();
    // Auto-prepend 0x if missing
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
    if (!confirm(`Send ${amt} G$ to ${recipients.length} wallets in one transaction?\n\nTotal: ${total} G$\n(auto-batched in groups of 400 if needed)`)) return;

    setBulkSending(true);
    setBulkResult(null);
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
        toast({ title: "Send failed", description: json?.error || `HTTP ${res.status}`, variant: "destructive" });
      } else {
        setBulkResult(json);
        if (json.ok) {
          toast({ title: `Sent ${json.total_sent} G$ to ${json.recipient_count} wallets` });
          setBulkSenderKey("");
        } else {
          toast({ title: "Partial failure", description: "Check batch results below", variant: "destructive" });
        }
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBulkSending(false);
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

          {/* ============ GAS LOADER REDIRECT TAB ============ */}
          <TabsContent value="gasloader" className="space-y-4">
            <Card className="glass-card-elevated">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Fuel className="size-5" /> Batch Gas Loader
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Sponsor CELO gas for many wallets at once. Configure delay,
                  auto-retry on timeouts, and rotate IPs per wallet.
                </p>
                <Button asChild className="w-full">
                  <Link to="/gas-loader">
                    <Fuel className="size-4" /> Open Batch Gas Loader
                  </Link>
                </Button>
              </CardContent>
            </Card>
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
                  Send G$ from one wallet to many recipients in a single transaction
                  using the audited Disperse contract. One gas fee for up to 400
                  recipients. Larger lists are auto-split into batches.
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
                    disabled={bulkSending}
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
                    disabled={bulkSending}
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
                    disabled={bulkSending}
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

                <Button onClick={runBulkSend} disabled={bulkSending} className="w-full">
                  {bulkSending ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />}
                  {bulkSending ? "Sending on chain…" : "Run bulk send"}
                </Button>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  First-time use sends a small approve transaction, then the bulk
                  transfer. Sender key is never stored.
                </p>

                {bulkResult && (
                  <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="p-2 rounded bg-primary/10 border border-primary/20">
                        <p className="text-lg font-bold text-primary">
                          {Number(bulkResult.total_sent).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase">G$ sent</p>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border border-border">
                        <p className="text-lg font-bold">{bulkResult.recipient_count}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">recipients</p>
                      </div>
                    </div>

                    {bulkResult.approve_tx && (
                      <div className="p-2 rounded bg-muted/40 border border-border text-xs">
                        <span className="text-muted-foreground">Approve tx: </span>
                        <a
                          href={`https://celoscan.io/tx/${bulkResult.approve_tx}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <ExternalLink className="size-3" /> view
                        </a>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      {bulkResult.batches.map((b, i) => (
                        <div key={i} className="p-2 rounded bg-muted/40 border border-border text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span>
                              Batch {i + 1} · {b.recipients} recipient{b.recipients === 1 ? "" : "s"}
                            </span>
                            {b.tx ? (
                              <a
                                href={`https://celoscan.io/tx/${b.tx}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline inline-flex items-center gap-1"
                              >
                                <ExternalLink className="size-3" /> tx
                              </a>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">failed</Badge>
                            )}
                          </div>
                          {b.error && (
                            <p className="text-[11px] text-destructive/80 mt-1 break-words">{b.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
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
