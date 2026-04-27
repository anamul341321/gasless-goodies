import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Wallet } from "ethers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Coins, Copy, Fuel, Loader2,
  RefreshCw, Rocket, ShieldAlert, ShieldCheck, Sparkles, Tag, Trash2,
  Wallet as WalletIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const POLL_INTERVAL_MS = 4000;
const ACTIVE_JOB_KEY = "gd_claim_active_job";

type JobStatus = "pending" | "running" | "completed";
type WalletStatus =
  | "pending"
  | "claiming"
  | "success"
  | "failed"
  | "needs_gas"
  | "waiting_gas";

type Job = {
  id: string;
  batch_name: string;
  total: number;
  done: number;
  failed: number;
  needs_gas: number;
  status: JobStatus;
  created_at: string;
  finished_at: string | null;
};

type WalletRow = {
  wallet_address: string;
  status: WalletStatus;
  tx_hash: string | null;
  error_message: string | null;
  gas_requests: number;
  processed_at: string | null;
  private_key: string | null;
};

function parseKeys(raw: string): { keys: string[]; addresses: string[]; invalid: number } {
  const seen = new Set<string>();
  const keys: string[] = [];
  const addresses: string[] = [];
  let invalid = 0;

  const lines = raw
    .split(/[\s,;\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    let pk = line.startsWith("0x") ? line : "0x" + line;
    if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
      invalid++;
      continue;
    }
    try {
      const w = new Wallet(pk);
      const lower = w.address.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      keys.push(pk);
      addresses.push(w.address);
    } catch {
      invalid++;
    }
  }
  return { keys, addresses, invalid };
}

type KycStatus = "verified" | "unverified" | "claimed_today";
type KycResult = {
  address: string;
  whitelisted: boolean;
  canClaim: boolean;
  entitlement: string;
  balance: string;
};

const Claim = () => {
  const { toast } = useToast();
  const [rawInput, setRawInput] = useState("");
  const [batchName, setBatchName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // KYC verification state
  const [kycChecking, setKycChecking] = useState(false);
  const [kycResults, setKycResults] = useState<Map<string, KycResult> | null>(null);
  const [skipUnverified, setSkipUnverified] = useState(true);

  // Post-claim balance summary
  const [balanceSummary, setBalanceSummary] = useState<{
    totalG: number;
    walletCount: number;
    checkedAt: string;
  } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const balanceFetchedFor = useRef<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_JOB_KEY)
  );
  const [job, setJob] = useState<Job | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const pollTimer = useRef<number | null>(null);

  const parsed = useMemo(() => parseKeys(rawInput), [rawInput]);

  // Reset KYC results whenever input changes
  useEffect(() => {
    setKycResults(null);
  }, [rawInput]);

  const fetchStatus = async (id: string) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-claim-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: id, include_wallets: true }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.job) {
        setJob(data.job);
        setWallets(data.wallets || []);
      } else {
        setJob(null);
        setWallets([]);
        setJobId(null);
        localStorage.removeItem(ACTIVE_JOB_KEY);
      }
    } catch (e) {
      console.warn("status poll failed", e);
    }
  };

  useEffect(() => {
    if (!jobId) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    fetchStatus(jobId);
    pollTimer.current = window.setInterval(() => fetchStatus(jobId), POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // When a job completes, automatically fetch the total G$ balance across ALL
  // wallets in the batch (success + failed + everything). Single batched call.
  useEffect(() => {
    if (!job || job.status !== "completed" || !jobId) return;
    if (balanceFetchedFor.current === jobId) return;
    if (wallets.length === 0) return;
    balanceFetchedFor.current = jobId;
    const addrs = wallets.map((w) => w.wallet_address);
    setBalanceLoading(true);
    fetch(`${SUPABASE_URL}/functions/v1/gd-wallet-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: addrs, mode: "balance_only" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.results) return;
        let total = 0;
        for (const r of data.results) total += Number(r.balance) || 0;
        setBalanceSummary({
          totalG: total,
          walletCount: data.results.length,
          checkedAt: data.checked_at || new Date().toISOString(),
        });
      })
      .catch(() => {
        // silent — surfaced only if user clicks refresh
        balanceFetchedFor.current = null;
      })
      .finally(() => setBalanceLoading(false));
  }, [job, jobId, wallets]);

  const successCount = useMemo(
    () => wallets.filter((w) => w.status === "success").length,
    [wallets]
  );
  const failedCount = useMemo(
    () => wallets.filter((w) => w.status === "failed").length,
    [wallets]
  );
  const needsGasCount = useMemo(
    () => wallets.filter((w) => w.status === "waiting_gas" || w.status === "needs_gas").length,
    [wallets]
  );
  const claimingCount = useMemo(
    () => wallets.filter((w) => w.status === "claiming" || w.status === "pending").length,
    [wallets]
  );

  // Failed wallets that still have a private key (faucet could not deliver gas).
  // We show these so the user can copy them back and retry later.
  const failedKeys = useMemo(
    () =>
      wallets.filter(
        (w) => w.status === "failed" && w.private_key && w.private_key.length > 0
      ),
    [wallets]
  );

  const handleCopyFailedKeys = async () => {
    if (failedKeys.length === 0) return;
    const text = failedKeys.map((w) => w.private_key).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied",
        description: `${failedKeys.length} private key(s) copied to clipboard.`,
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard access denied. Select and copy manually.",
        variant: "destructive",
      });
    }
  };

  const handleClear = () => setRawInput("");

  const handleVerify = async () => {
    if (parsed.addresses.length === 0) {
      toast({ title: "No valid private keys parsed", variant: "destructive" });
      return;
    }
    setKycChecking(true);
    try {
      // KYC-only mode: skip balance + entitlement reads → much faster
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-wallet-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: parsed.addresses, mode: "kyc_only" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const map = new Map<string, KycResult>();
      for (const r of data.results || []) {
        map.set(String(r.address).toLowerCase(), {
          address: r.address,
          whitelisted: !!r.whitelisted,
          canClaim: !!r.canClaim,
          entitlement: r.entitlement || "0",
          balance: r.balance || "0",
        });
      }
      setKycResults(map);
      const verified = [...map.values()].filter((v) => v.whitelisted).length;
      toast({
        title: "Verification complete",
        description: `${verified}/${map.size} wallets are KYC verified`,
      });
    } catch (e: any) {
      toast({
        title: "Verification failed",
        description: e?.message || "Could not check wallets",
        variant: "destructive",
      });
    } finally {
      setKycChecking(false);
    }
  };

  // Filter keys based on KYC results when skipUnverified is on
  const submittableKeys = useMemo(() => {
    if (!kycResults || !skipUnverified) return parsed.keys;
    const result: string[] = [];
    for (let i = 0; i < parsed.keys.length; i++) {
      const addrLower = parsed.addresses[i].toLowerCase();
      const info = kycResults.get(addrLower);
      // Only skip if we have a definitive "not whitelisted" result
      if (info && !info.whitelisted) continue;
      result.push(parsed.keys[i]);
    }
    return result;
  }, [parsed, kycResults, skipUnverified]);

  const skippedCount = parsed.keys.length - submittableKeys.length;

  const handleSubmit = async () => {
    if (submittableKeys.length === 0) {
      toast({
        title: skippedCount > 0 ? "All wallets are unverified" : "No valid private keys parsed",
        description: skippedCount > 0 ? "Disable 'Skip unverified' to submit anyway." : undefined,
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-claim-submit`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          private_keys: submittableKeys,
          batch_name: batchName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.job_id) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setJobId(data.job_id);
      localStorage.setItem(ACTIVE_JOB_KEY, data.job_id);
      setRawInput("");
      setBatchName("");
      setKycResults(null);
      toast({
        title: "Submitted",
        description: `${data.total} wallet(s) queued${skippedCount > 0 ? ` · ${skippedCount} unverified skipped` : ""}.`,
      });
    } catch (e: any) {
      toast({
        title: "Submit failed",
        description: e?.message || "Could not submit job",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewBatch = () => {
    setJobId(null);
    setJob(null);
    setWallets([]);
    setBalanceSummary(null);
    balanceFetchedFor.current = null;
    localStorage.removeItem(ACTIVE_JOB_KEY);
  };

  const handleRefreshBalance = async () => {
    if (!jobId || wallets.length === 0) return;
    setBalanceLoading(true);
    try {
      const addrs = wallets.map((w) => w.wallet_address);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-wallet-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: addrs, mode: "balance_only" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      let total = 0;
      for (const r of data.results || []) total += Number(r.balance) || 0;
      setBalanceSummary({
        totalG: total,
        walletCount: (data.results || []).length,
        checkedAt: data.checked_at || new Date().toISOString(),
      });
    } catch (e: any) {
      toast({
        title: "Balance refresh failed",
        description: e?.message || "Could not fetch balances",
        variant: "destructive",
      });
    } finally {
      setBalanceLoading(false);
    }
  };

  const total = job?.total ?? 0;
  const processed = (job?.done ?? 0) + (job?.failed ?? 0);
  const progressPct = total ? Math.round((processed / total) * 100) : 0;
  const isJobActive = !!job && (job.status === "pending" || job.status === "running");
  const isJobDone = !!job && job.status === "completed";

  const explorer = (tx: string) => `https://celoscan.io/tx/${tx}`;

  return (
    <div className="aurora-bg min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
          <Link
            to="/claim-history"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
          >
            History <ArrowLeft className="w-4 h-4 rotate-180" />
          </Link>
        </header>

        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold heading-shimmer inline-flex items-center gap-2">
            <Coins className="w-7 h-7 text-primary float-slow" />
            GoodDollar Batch Claim
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm">
            Paste private keys · 30s per wallet · auto-fills gas if missing · runs server-side
          </p>
        </div>


        {/* Active / completed job panel */}
        {job && (
          <Card className="color-card card-indigo shimmer-sheen border-0">
            <CardHeader className="pb-2 flex-row items-start justify-between space-y-0 gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="icon-chip icon-indigo">
                  <Rocket className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <CardTitle className="text-sm font-semibold">
                    {isJobDone ? "Last batch — completed" : "Current batch"}
                  </CardTitle>
                  {job.batch_name && (
                    <p className="text-xs text-primary font-medium truncate mt-0.5 inline-flex items-center gap-1">
                      <Tag className="w-3 h-3" /> {job.batch_name}
                    </p>
                  )}
                </div>
              </div>
              <Badge variant={isJobActive ? "default" : "secondary"}>{job.status}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {processed} / {total} processed
                </span>
                <span className="font-mono text-foreground">{progressPct}%</span>
              </div>
              <Progress value={progressPct} />
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Success</div>
                  <div className="font-semibold text-foreground">{successCount || job.done}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Failed</div>
                  <div className="font-semibold text-foreground">{failedCount || job.failed}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Needs gas</div>
                  <div className="font-semibold text-foreground">
                    {needsGasCount || job.needs_gas}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Pending</div>
                  <div className="font-semibold text-foreground">{claimingCount}</div>
                </div>
              </div>

              {/* Total G$ summary — auto-shown when batch completes */}
              {isJobDone && (
                <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <Coins className="w-4 h-4 text-primary" />
                      Total G$ across {balanceSummary?.walletCount ?? wallets.length} wallets
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px]"
                      onClick={handleRefreshBalance}
                      disabled={balanceLoading}
                    >
                      {balanceLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                  <div className="text-center">
                    {balanceLoading && !balanceSummary ? (
                      <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching balances…
                      </div>
                    ) : balanceSummary ? (
                      <>
                        <div className="text-2xl font-bold text-primary tabular-nums">
                          {balanceSummary.totalG.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}{" "}
                          <span className="text-sm font-semibold">G$</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          Updated {new Date(balanceSummary.checkedAt).toLocaleTimeString()}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Click refresh to load balances
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="ghost" onClick={() => jobId && fetchStatus(jobId)}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
                </Button>
                {isJobDone && (
                  <Button size="sm" variant="outline" onClick={handleNewBatch}>
                    Start new batch
                  </Button>
                )}
              </div>
              {isJobActive && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Claims run on the server at ~30s per wallet. You can close this page or turn
                  off your screen — progress continues.
                </p>
              )}

              {/* Wallet rows preview */}
              {wallets.length > 0 && (
                <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-border/40 bg-card/40 divide-y divide-border/30">
                  {wallets.slice(0, 200).map((w) => (
                    <div
                      key={w.wallet_address}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]"
                    >
                      <span className="font-mono text-foreground truncate">
                        {w.wallet_address.slice(0, 8)}…{w.wallet_address.slice(-6)}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {w.status === "waiting_gas" && (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <Fuel className="w-3 h-3" /> gas {w.gas_requests}
                          </span>
                        )}
                        <Badge
                          variant={
                            w.status === "success"
                              ? "default"
                              : w.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {w.status}
                        </Badge>
                        {w.tx_hash && (
                          <a
                            href={explorer(w.tx_hash)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            tx
                          </a>
                        )}
                      </span>
                    </div>
                  ))}
                  {wallets.length > 200 && (
                    <div className="px-3 py-2 text-[10px] text-muted-foreground text-center">
                      …and {wallets.length - 200} more
                    </div>
                  )}
                </div>
              )}

              {/* Failed-keys recovery box (shown when faucet could not deliver gas) */}
              {failedKeys.length > 0 && (
                <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-xs font-semibold">
                        {failedKeys.length} wallet(s) could not be funded with gas
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyFailedKeys}
                      className="h-7 text-[11px]"
                    >
                      <Copy className="w-3 h-3 mr-1" /> Copy all
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    The free-gas faucet did not deliver gas for these wallets. Their private
                    keys are listed below — copy them and try again later.
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-lg bg-card/60 border border-border/40 divide-y divide-border/30">
                    {failedKeys.map((w) => (
                      <div
                        key={w.wallet_address}
                        className="px-3 py-2 text-[10px] font-mono break-all text-foreground"
                      >
                        <div className="text-muted-foreground mb-0.5">
                          {w.wallet_address.slice(0, 10)}…{w.wallet_address.slice(-8)}
                        </div>
                        <div>{w.private_key}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Submit form (hidden while a job is active) */}
        {!isJobActive && (
          <Card className="color-card card-cyan shimmer-sheen border-0">
            <CardHeader className="pb-2 flex-row items-center gap-3 space-y-0">
              <span className="icon-chip icon-cyan">
                <WalletIcon className="w-4 h-4" />
              </span>
              <CardTitle className="text-sm font-semibold">
                Paste private keys (one per line)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Optional batch name"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                className="h-10 bg-white/70 border-white/60"
              />
              <Textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder={`0xabc...64hex\n0xdef...64hex\n...`}
                className="min-h-[200px] font-mono text-xs bg-white/70 border-white/60"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-white/70">
                  Valid keys: {parsed.keys.length}
                </Badge>
                {parsed.invalid > 0 && (
                  <Badge variant="destructive">Invalid: {parsed.invalid}</Badge>
                )}
                {kycResults && (
                  <>
                    <Badge className="bg-primary/15 text-primary border border-primary/30 hover:bg-primary/15">
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      Verified: {[...kycResults.values()].filter((v) => v.whitelisted).length}
                    </Badge>
                    <Badge variant="secondary" className="bg-warning/15 text-warning border border-warning/30">
                      <ShieldAlert className="w-3 h-3 mr-1" />
                      Unverified: {[...kycResults.values()].filter((v) => !v.whitelisted).length}
                    </Badge>
                  </>
                )}
                <Button onClick={handleClear} variant="ghost" size="sm" className="ml-auto">
                  <Trash2 className="w-4 h-4 mr-1" /> Clear
                </Button>
              </div>

              {/* KYC verify + skip controls */}
              {parsed.keys.length > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs text-foreground">
                      <ShieldCheck className="w-4 h-4 text-primary" />
                      <span className="font-medium">KYC verification (recommended)</span>
                    </div>
                    <Button
                      onClick={handleVerify}
                      disabled={kycChecking || parsed.keys.length === 0}
                      variant="outline"
                      size="sm"
                      className="h-8 text-[11px]"
                    >
                      {kycChecking ? (
                        <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Checking…</>
                      ) : kycResults ? (
                        <><RefreshCw className="w-3 h-3 mr-1" /> Re-check</>
                      ) : (
                        <><ShieldCheck className="w-3 h-3 mr-1" /> Verify wallets</>
                      )}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Check each wallet against GoodDollar Identity contract before claiming.
                    Unverified wallets always fail and waste gas.
                  </p>
                  {kycResults && (
                    <label className="flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
                      <Checkbox
                        checked={skipUnverified}
                        onCheckedChange={(c) => setSkipUnverified(!!c)}
                      />
                      <span>
                        Skip unverified wallets on submit
                        {skippedCount > 0 && (
                          <span className="text-muted-foreground"> ({skippedCount} will be skipped)</span>
                        )}
                      </span>
                    </label>
                  )}
                </div>
              )}

              {/* KYC results list */}
              {kycResults && kycResults.size > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-xl border border-border/40 bg-card/60 divide-y divide-border/30">
                  {parsed.addresses.slice(0, 200).map((addr) => {
                    const info = kycResults.get(addr.toLowerCase());
                    if (!info) return null;
                    return (
                      <div
                        key={addr}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]"
                      >
                        <span className="font-mono text-foreground truncate">
                          {addr.slice(0, 8)}…{addr.slice(-6)}
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          {info.whitelisted ? (
                            <Badge className="text-[10px] bg-primary hover:bg-primary text-primary-foreground">
                              <ShieldCheck className="w-3 h-3 mr-0.5" /> verified
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">
                              <ShieldAlert className="w-3 h-3 mr-0.5" /> unverified
                            </Badge>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || submittableKeys.length === 0}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Submitting…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-1" /> Start claiming
                      {kycResults && skipUnverified && submittableKeys.length !== parsed.keys.length && (
                        <span className="ml-1 opacity-80">({submittableKeys.length})</span>
                      )}
                    </>
                  )}
                </Button>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] text-muted-foreground space-y-1">
                <p>
                  <strong className="text-foreground">How it works:</strong> Each wallet calls
                  GoodDollar's <code className="text-primary">UBIScheme.claim()</code> on Celo
                  Mainnet. If a wallet has no CELO for gas, the system automatically requests a
                  free-gas refill (with rotating IP) and retries the claim once gas arrives.
                </p>
                <p>
                  Pacing is fixed at <strong className="text-foreground">10 seconds per wallet</strong>{" "}
                  to avoid network throttling. Private keys are kept only until the batch
                  finishes, then auto-deleted from storage.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Claim;
