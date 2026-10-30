import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "@/lib/router-compat";
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
  AlertTriangle, ArrowLeft, CheckCircle2, Coins, Copy, Eye, EyeOff, Fuel, Key,
  Loader2, RefreshCw, Rocket, ShieldAlert, ShieldCheck, Sparkles, Tag, Trash2,
  Wallet as WalletIcon, User, LogIn,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const POLL_INTERVAL_MS = 4000;
const ACTIVE_JOB_KEY = "gd_claim_active_job";

type JobStatus = "pending" | "running" | "completed";
type WalletStatus =
  | "pending"
  | "claiming"
  | "success"
  | "already_claimed"
  | "failed"
  | "failed_gas"
  | "failed_kyc"
  | "needs_gas"
  | "waiting_gas";

type ClaimNetwork = "celo" | "xdc";

const NETWORK_META: Record<ClaimNetwork, { label: string; explorerTx: string; nativeGas: string }> = {
  celo: { label: "Celo Mainnet", explorerTx: "https://celoscan.io/tx/", nativeGas: "CELO" },
  xdc: { label: "XDC Mainnet", explorerTx: "https://xdcscan.com/tx/", nativeGas: "XDC" },
};

type Job = {
  id: string;
  batch_name: string;
  total: number;
  done: number;
  failed: number;
  needs_gas: number;
  status: JobStatus;
  network?: ClaimNetwork;
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
  const { user, loading: authLoading } = useAuth();
  const [rawInput, setRawInput] = useState("");
  const [batchName, setBatchName] = useState("");
  const [network, setNetwork] = useState<ClaimNetwork>("celo");
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

  const storageKey = `${ACTIVE_JOB_KEY}:${user?.id || "signed-out"}`;
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const pollTimer = useRef<number | null>(null);
  const restoredJobRef = useRef(false);
  useEffect(() => {
    setJob(null); setWallets([]); setBalanceSummary(null);
    const saved = user ? localStorage.getItem(storageKey) : null;
    restoredJobRef.current = !!saved; setJobId(saved);
  }, [user?.id]);

  const parsed = useMemo(() => parseKeys(rawInput), [rawInput]);

  // Reset KYC results whenever input changes
  useEffect(() => {
    setKycResults(null);
  }, [rawInput]);

  const fetchStatus = async (id: string) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-claim-status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ job_id: id, include_wallets: true }),
      });
      if (!res.ok) { setJob(null); setWallets([]); return; }
      const data = await res.json();
      if (data.job) {
        if (data.job.status === "completed") {
          localStorage.removeItem(storageKey);
          if (restoredJobRef.current && !job) {
            setJob(null);
            setWallets([]);
            setJobId(null);
            return;
          }
        }
        setJob(data.job);
        setWallets(data.wallets || []);
      } else {
        setJob(null);
        setWallets([]);
        setJobId(null);
        localStorage.removeItem(storageKey);
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
      body: JSON.stringify({ addresses: addrs, mode: "balance_only", network: job.network || "celo" }),
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
  const alreadyClaimedKeys = useMemo(
    () => wallets.filter((w) => w.status === "already_claimed"),
    [wallets]
  );
  const needsGasCount = useMemo(
    () => wallets.filter((w) => w.status === "failed_gas" || w.status === "waiting_gas" || w.status === "needs_gas").length,
    [wallets]
  );
  const notWhitelistedCount = useMemo(
    () => wallets.filter((w) => w.status === "failed_kyc" || (w.status === "failed" && /whitelist|identity|not verified/i.test(w.error_message || ""))).length,
    [wallets]
  );

  // Recovery groups
  const failedGasKeys = useMemo(
    () => wallets.filter((w) => w.status === "failed_gas" && w.private_key && w.private_key.length > 0),
    [wallets]
  );
  const failedKycKeys = useMemo(
    () => wallets.filter((w) => (w.status === "failed_kyc" || (w.status === "failed" && /whitelist|identity|not verified/i.test(w.error_message || ""))) && w.private_key && w.private_key.length > 0),
    [wallets]
  );
  const failedOtherKeys = useMemo(
    () => wallets.filter((w) => w.status === "failed" && !/whitelist|identity|not verified/i.test(w.error_message || "") && w.private_key && w.private_key.length > 0),
    [wallets]
  );

  const copyList = async (rows: WalletRow[], field: "private_key" | "wallet_address", label: string) => {
    if (rows.length === 0) return;
    const text = rows.map((w) => (field === "private_key" ? w.private_key : w.wallet_address)).filter(Boolean).join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "কপি হয়েছে", description: `${rows.length} ${label} copied to clipboard.` });
    } catch {
      toast({ title: "কপি হয়নি", description: "কপি করার অনুমতি নেই।", variant: "destructive" });
    }
  };

  const handleClear = () => setRawInput("");

  const handleVerify = async () => {
    if (parsed.addresses.length === 0) {
      toast({ title: "সঠিক প্রাইভেট কী দিন", variant: "destructive" });
      return;
    }
    setKycChecking(true);
    try {
      // KYC-only mode: skip balance + entitlement reads → much faster
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-wallet-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: parsed.addresses, mode: "kyc_only", network }),
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
        title: "ভেরিফিকেশন দেখা হয়েছে",
        description: `${verified}/${map.size} wallets are KYC verified`,
      });
    } catch (e: any) {
      toast({
        title: "ভেরিফিকেশন দেখা যায়নি",
        description: e?.message || "পরে আবার চেষ্টা করুন",
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
        title: skippedCount > 0 ? "কোনো ওয়ালেট ভেরিফাই করা নেই" : "সঠিক প্রাইভেট কী দিন",
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
          network,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.job_id) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setJobId(data.job_id);
      restoredJobRef.current = false;
      localStorage.setItem(storageKey, data.job_id);
      setRawInput("");
      setBatchName("");
      setKycResults(null);
      toast({
        title: "অনুরোধ পাঠানো হয়েছে",
        description: `${data.total} wallet(s) queued${skippedCount > 0 ? ` · ${skippedCount} unverified skipped` : ""}.`,
      });
    } catch (e: any) {
      toast({
        title: "অনুরোধ পাঠানো যায়নি",
        description: e?.message || "পরে আবার চেষ্টা করুন",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewBatch = () => {
    setJobId(null);
    restoredJobRef.current = false;
    setJob(null);
    setWallets([]);
    setBalanceSummary(null);
    balanceFetchedFor.current = null;
    localStorage.removeItem(storageKey);
  };

  const handleRefreshBalance = async () => {
    if (!jobId || wallets.length === 0) return;
    setBalanceLoading(true);
    try {
      const addrs = wallets.map((w) => w.wallet_address);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-wallet-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: addrs, mode: "balance_only", network: job?.network || "celo" }),
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
        title: "ব্যালেন্স দেখা যায়নি",
        description: e?.message || "পরে আবার চেষ্টা করুন",
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

  const jobNetwork: ClaimNetwork = (job?.network as ClaimNetwork) || "celo";
  const explorer = (tx: string) => `${NETWORK_META[jobNetwork].explorerTx}${tx}`;

  // Login is required to use the claim feature
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center aurora-bg">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="aurora-bg min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> ড্যাশবোর্ড
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9 rounded-xl font-semibold">
              <Link to={user ? "/account" : "/auth"}>
                {user ? <User className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                {user ? "আমার ব্যাচ" : "লগইন"}
              </Link>
            </Button>
            <Link
              to="/claim-history"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
            >
              আমার ইতিহাস <ArrowLeft className="w-4 h-4 rotate-180" />
            </Link>
          </div>
        </header>

        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold heading-shimmer inline-flex items-center gap-2">
            <Coins className="w-7 h-7 text-primary float-slow" />
            একসাথে G$ ক্লেইম
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm">
            Celo · XDC
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
                    {isJobDone ? "শেষ ব্যাচ সম্পন্ন" : "চলতি ব্যাচ"}
                  </CardTitle>
                  {job.batch_name && (
                    <p className="text-xs text-primary font-medium truncate mt-0.5 inline-flex items-center gap-1">
                      <Tag className="w-3 h-3" /> {job.batch_name}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant={isJobActive ? "default" : "secondary"}>{statusBn(job.status)}</Badge>
                <Badge variant="outline" className="text-[10px]">{NETWORK_META[jobNetwork].label}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {processed} / {total} টি সম্পন্ন
                </span>
                <span className="font-mono text-foreground">{progressPct}%</span>
              </div>
              <Progress value={progressPct} />
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">সফল</div>
                  <div className="font-semibold text-foreground">{successCount || job.done}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">গ্যাস নেই</div>
                  <div className="font-semibold text-foreground">{needsGasCount || job.needs_gas}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">আগেই নেওয়া</div>
                  <div className="font-semibold text-foreground">{alreadyClaimedKeys.length}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">ভেরিফাই নেই</div>
                  <div className="font-semibold text-foreground">{notWhitelistedCount}</div>
                </div>
              </div>

              {/* Total G$ summary — auto-shown when batch completes */}
              {isJobDone && (
                <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <Coins className="w-4 h-4 text-primary" />
                      {balanceSummary?.walletCount ?? wallets.length} টি ওয়ালেটের মোট G$
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
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> ব্যালেন্স আসছে…
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
                          হালনাগাদ: {new Date(balanceSummary.checkedAt).toLocaleTimeString()}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        ব্যালেন্স দেখতে হালনাগাদ করুন
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="ghost" onClick={() => jobId && fetchStatus(jobId)}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> হালনাগাদ
                </Button>
                <Button size="sm" variant={isJobDone ? "default" : "outline"} onClick={handleNewBatch}>
                  {isJobDone ? "নতুন ব্যাচ শুরু করুন" : "নতুন ব্যাচ / নেটওয়ার্ক বদলান"}
                </Button>
              </div>
              {isJobActive && (
                <p className="text-[11px] text-muted-foreground text-center">
                  
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
                              : w.status === "already_claimed"
                              ? "secondary"
                              : w.status.startsWith("failed")
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {statusBn(w.status)}
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
                      …আরও {wallets.length - 200} টি
                    </div>
                  )}
                </div>
              )}

              {isJobDone && (failedGasKeys.length + failedKycKeys.length + failedOtherKeys.length) > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <span className="text-[11px] text-muted-foreground">
                    {failedGasKeys.length + failedKycKeys.length + failedOtherKeys.length} টি চূড়ান্ত ব্যর্থ ওয়ালেট
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copyList(
                        [...failedGasKeys, ...failedKycKeys, ...failedOtherKeys],
                        "private_key",
                        "private key(s)"
                      )
                    }
                  >
                    <Copy className="w-3 h-3 mr-1" /> সব ব্যর্থ কী কপি
                  </Button>
                </div>
              )}

              <RecoveryBox
                title={`গ্যাস নেই (${NETWORK_META[jobNetwork].nativeGas} needed)`}
                description={`ক্লেইমের জন্য ${NETWORK_META[jobNetwork].nativeGas} কম ছিল। গ্যাস নিয়ে আবার চেষ্টা করুন।`}
                tone="warning"
                rows={failedGasKeys}
                onCopy={copyList}
              />
              <RecoveryBox
                title="আগেই ক্লেইম করার প্রমাণ আছে"
                description="বর্তমান সময়ে ক্লেইম নেওয়ার প্রমাণ পাওয়া গেছে। পরের ক্লেইমের সময় আবার চেষ্টা করুন।"
                tone="info"
                rows={alreadyClaimedKeys}
                onCopy={copyList}
              />
              <RecoveryBox
                title="ফেস ভেরিফিকেশন দরকার"
                description="আগে ফেস ভেরিফিকেশন সম্পন্ন করুন।"
                tone="info"
                rows={failedKycKeys}
                onCopy={copyList}
              />
              {failedOtherKeys.length > 0 && (
                <RecoveryBox
                  title="অন্যান্য ব্যর্থতা"
                  description="অন্যান্য কারণে ব্যর্থ হয়েছে।"
                  tone="destructive"
                  rows={failedOtherKeys}
                  onCopy={copyList}
                />
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
                প্রতি লাইনে একটি প্রাইভেট কী দিন
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Network selector */}
              <div className="rounded-lg border border-border/40 bg-card/40 p-2">
                <div className="text-[11px] text-muted-foreground mb-1.5 px-1">নেটওয়ার্ক</div>
                <div className="grid grid-cols-2 gap-2">
                  {(["celo", "xdc"] as ClaimNetwork[]).map((n) => (
                    <Button
                      type="button"
                      key={n}
                      onClick={() => setNetwork(n)}
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                        network === n
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/40 bg-card/60 text-foreground hover:bg-card"
                      }`}
                    >
                      {NETWORK_META[n].label}
                    </Button>
                  ))}
                </div>
              </div>
              <Input
                placeholder="ব্যাচের নাম (ইচ্ছামতো)"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                className="h-10 bg-card/70 border-border/60"
              />
              <Textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder={`0xabc...64hex\n0xdef...64hex\n...`}
                className="min-h-[200px] font-mono text-xs bg-card/70 border-border/60"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-card/70">
                  সঠিক কী: {parsed.keys.length}
                </Badge>
                {parsed.invalid > 0 && (
                  <Badge variant="destructive">ভুল: {parsed.invalid}</Badge>
                )}
                {kycResults && (
                  <>
                    <Badge className="bg-primary/15 text-primary border border-primary/30 hover:bg-primary/15">
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      ভেরিফাই আছে: {[...kycResults.values()].filter((v) => v.whitelisted).length}
                    </Badge>
                    <Badge variant="secondary" className="bg-warning/15 text-warning border border-warning/30">
                      <ShieldAlert className="w-3 h-3 mr-1" />
                      ভেরিফাই নেই: {[...kycResults.values()].filter((v) => !v.whitelisted).length}
                    </Badge>
                  </>
                )}
                <Button onClick={handleClear} variant="ghost" size="sm" className="ml-auto">
                  <Trash2 className="w-4 h-4 mr-1" /> মুছুন
                </Button>
              </div>

              {/* KYC verify + skip controls */}
              {parsed.keys.length > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs text-foreground">
                      <ShieldCheck className="w-4 h-4 text-primary" />
                      <span className="font-medium">ফেস ভেরিফিকেশন পরীক্ষা</span>
                    </div>
                    <Button
                      onClick={handleVerify}
                      disabled={kycChecking || parsed.keys.length === 0}
                      variant="outline"
                      size="sm"
                      className="h-8 text-[11px]"
                    >
                      {kycChecking ? (
                        <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> দেখা হচ্ছে…</>
                      ) : kycResults ? (
                        <><RefreshCw className="w-3 h-3 mr-1" /> আবার দেখুন</>
                      ) : (
                        <><ShieldCheck className="w-3 h-3 mr-1" /> ভেরিফিকেশন দেখুন</>
                      )}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    
                  </p>
                  {kycResults && (
                    <label className="flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
                      <Checkbox
                        checked={skipUnverified}
                        onCheckedChange={(c) => setSkipUnverified(!!c)}
                      />
                      <span>
                        ভেরিফাই না থাকলে বাদ দিন
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
                              <ShieldCheck className="w-3 h-3 mr-0.5" /> ভেরিফাই আছে
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">
                              <ShieldAlert className="w-3 h-3 mr-0.5" /> ভেরিফাই নেই
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
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" /> অনুরোধ যাচ্ছে…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-1" /> ক্লেইম শুরু করুন
                      {kycResults && skipUnverified && submittableKeys.length !== parsed.keys.length && (
                        <span className="ml-1 opacity-80">({submittableKeys.length})</span>
                      )}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

type RecoveryRow = {
  wallet_address: string;
  private_key: string | null;
};

function statusBn(status: string) {
  return ({ pending: "অপেক্ষায়", running: "চলছে", claiming: "ক্লেইম হচ্ছে", completed: "সম্পন্ন", success: "সফল", already_claimed: "আগেই নেওয়া", failed: "ব্যর্থ", failed_gas: "গ্যাস নেই", failed_kyc: "ভেরিফাই নেই", waiting_gas: "গ্যাসের অপেক্ষা", needs_gas: "গ্যাস দরকার" } as Record<string, string>)[status] || "অপেক্ষায়";
}

function RecoveryBox({
  title,
  description,
  tone,
  rows,
  onCopy,
}: {
  title: string;
  description: string;
  tone: "warning" | "info" | "destructive";
  rows: RecoveryRow[];
  onCopy: (rows: any[], field: "private_key" | "wallet_address", label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showPk, setShowPk] = useState(true);
  const [showAddr, setShowAddr] = useState(false);
  if (rows.length === 0) return null;
  const toneClass =
    tone === "warning"
      ? "border-warning/40 bg-warning/5"
      : tone === "info"
      ? "border-primary/30 bg-primary/5"
      : "border-destructive/30 bg-destructive/5";
  const iconClass =
    tone === "warning" ? "text-warning" : tone === "info" ? "text-primary" : "text-destructive";
  const Icon = tone === "warning" ? Fuel : tone === "info" ? ShieldAlert : AlertTriangle;
  return (
    <div className={`mt-3 rounded-2xl border ${toneClass} p-3 space-y-2 shadow-lg backdrop-blur transition-all duration-300 hover:shadow-xl`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl px-1 py-1 text-left transition-transform active:scale-[0.98]"
      >
        <div className={`flex items-center gap-3 ${iconClass}`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-card/70 border border-border/40 shadow-inner">
            <Icon className="w-4 h-4" />
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-bold">{title}</span>
            <span className="text-[11px] text-muted-foreground">{rows.length} টি ওয়ালেট · {open ? "বন্ধ করতে চাপুন" : "কী দেখতে চাপুন"}</span>
          </span>
        </div>
        <span className={`text-lg transition-transform duration-300 ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      <Button size="sm" className="w-full h-9 font-semibold"
        onClick={() => onCopy(rows, "private_key", "private key(s)")}>
        <Copy className="w-4 h-4 mr-1" /> সব কী কপি ({rows.length})
      </Button>
      {open && (<>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button size="sm" variant="ghost" className="h-7 text-[11px]"
            onClick={() => setShowAddr((v) => !v)}>
            {showAddr ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
            ঠিকানা
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]"
            onClick={() => setShowPk((v) => !v)}>
            {showPk ? <EyeOff className="w-3 h-3 mr-1" /> : <Key className="w-3 h-3 mr-1" />}
            প্রাইভেট কী
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]"
            onClick={() => onCopy(rows, "wallet_address", "address(es)")}>
            <Copy className="w-3 h-3 mr-1" /> ঠিকানা কপি
          </Button>
        </div>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      <div className="max-h-56 overflow-y-auto rounded-lg bg-card/60 border border-border/40 divide-y divide-border/30">
        {rows.map((w) => (
          <div key={w.wallet_address} className="px-3 py-2 text-[10px] font-mono break-all">
            {showAddr && (
              <div className="text-foreground">
                <span className="text-muted-foreground">addr: </span>{w.wallet_address}
              </div>
            )}
            {showPk && w.private_key && (
              <div className="text-foreground mt-0.5">
                <span className="text-muted-foreground">pk: </span>{w.private_key}
              </div>
            )}
            {!showAddr && !showPk && (
              <div className="text-muted-foreground">ঠিকানা বা প্রাইভেট কী দেখতে বোতাম চাপুন</div>
            )}
          </div>
        ))}
      </div>
      </>)}
    </div>
  );
}

export default Claim;
