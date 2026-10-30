import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/router-compat";
import { Wallet } from "ethers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Loader2, Rocket, Trash2, RefreshCw, History as HistoryIcon, Tag, Sparkles, PowerOff, Wallet as Wallet2Icon, Settings as SettingsIcon } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const POLL_INTERVAL_MS = 4000;
const ACTIVE_JOB_KEY = "gl_active_job_id";

type JobStatus = "pending" | "running" | "completed";
type WalletStatus = "pending" | "processing" | "success" | "failed";

type Job = {
  id: string;
  total: number;
  done: number;
  failed: number;
  status: JobStatus;
  delay_ms: number;
  created_at: string;
  finished_at: string | null;
  batch_name?: string;
};

type WalletRow = {
  wallet_address: string;
  status: WalletStatus;
  tx_hash: string | null;
  error_message: string | null;
  processed_at: string | null;
};

function parseInputLines(raw: string): { addresses: string[]; invalid: string[] } {
  const addresses: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  const lines = raw
    .split(/[\s,;\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    let addr: string | null = null;
    if (/^0x[a-fA-F0-9]{40}$/.test(line)) {
      addr = line;
    } else if (/^(0x)?[a-fA-F0-9]{64}$/.test(line)) {
      try {
        const pk = line.startsWith("0x") ? line : "0x" + line;
        addr = new Wallet(pk).address;
      } catch {
        invalid.push(line);
        continue;
      }
    } else {
      invalid.push(line);
      continue;
    }

    const lower = addr.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    addresses.push(addr);
  }

  return { addresses, invalid };
}

const GasLoader = () => {
  const { toast } = useToast();
  const { user, session, loading: authLoading } = useAuth();
  const accessPassword = "";
  const setAccessPassword = (_value: string) => {};
  const storageKey = `${ACTIVE_JOB_KEY}:${user?.id || "signed-out"}`;
  const [rawInput, setRawInput] = useState("");
  const [parsed, setParsed] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [delaySec, setDelaySec] = useState(3);
  const [batchName, setBatchName] = useState("");
  const [network, setNetwork] = useState<"celo" | "xdc" | "fuse">(
    () => (localStorage.getItem("gl_network") as "celo" | "xdc" | "fuse") || "celo"
  );
  const [loaderEnabled, setLoaderEnabled] = useState<boolean>(true);

  useEffect(() => {
    localStorage.setItem("gl_network", network);
  }, [network]);


  // Active server-side job state
  const [jobId, setJobId] = useState<string | null>(null);
  useEffect(() => {
    setJob(null); setWallets([]);
    setJobId(user ? localStorage.getItem(storageKey) : null);
  }, [user?.id]);
  const [job, setJob] = useState<Job | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pollTimer = useRef<number | null>(null);

  // Persist password
  useEffect(() => {
    const pw = accessPassword.trim();
    if (pw) {
      localStorage.setItem("gl_admin_pw", pw);
      sessionStorage.setItem("gl_admin_pw", pw);
    }
  }, [accessPassword]);

  // Live admin toggle: fetch + subscribe to realtime changes
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const { data } = await supabase.rpc("get_safe_admin_settings");
      if (!mounted) return;
      const row = Array.isArray(data) ? data[0] : null;
      if (row && typeof row.gas_loader_enabled === "boolean") {
        setLoaderEnabled(row.gas_loader_enabled);
      }
    };
    refresh();
    const channel = supabase
      .channel("admin-settings-loader-flag")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_settings" },
        (payload: any) => {
          const next = payload?.new?.gas_loader_enabled;
          if (typeof next === "boolean") setLoaderEnabled(next);
        }
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Parse textarea (only when no active job is running)
  useEffect(() => {
    if (jobId) return;
    const { addresses, invalid: inv } = parseInputLines(rawInput);
    setParsed(addresses);
    setInvalid(inv);
  }, [rawInput, jobId]);

  // Poll job status from server
  const fetchStatus = async (id: string) => {
    if (!session?.access_token) return;
    const pw = accessPassword.trim();
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gas-loader-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ job_id: id, include_wallets: true }),
      });
      if (res.status === 401) {
        setJob(null); setWallets([]);
        toast({
          title: "আবার লগইন করুন",
          description: "আপনার অ্যাকাউন্টে আবার লগইন করুন।",
          variant: "destructive",
        });
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.job) {
        setJob(data.job);
        setWallets(data.wallets || []);
        if (data.job.status === "completed") {
          // Stop polling, but keep job visible
        }
      } else {
        // Job vanished — clear
        setJob(null);
        setWallets([]);
        setJobId(null);
        localStorage.removeItem(storageKey);
      }
    } catch (e) {
      console.warn("status poll failed", e);
    }
  };

  // Polling lifecycle
  useEffect(() => {
    if (!jobId) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    // Immediate fetch + interval
    fetchStatus(jobId);
    pollTimer.current = window.setInterval(() => {
      fetchStatus(jobId);
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, session?.access_token]);

  const successCount = useMemo(
    () => wallets.filter((w) => w.status === "success").length,
    [wallets]
  );
  const failedCount = useMemo(
    () => wallets.filter((w) => w.status === "failed").length,
    [wallets]
  );
  const pendingCount = useMemo(
    () =>
      wallets.filter((w) => w.status === "pending" || w.status === "processing")
        .length,
    [wallets]
  );

  const handleClear = () => {
    setRawInput("");
    setParsed([]);
    setInvalid([]);
  };

  const handleSubmit = async () => {
    const pw = accessPassword.trim();
    const name = batchName.trim();
    if (false && !pw) {
      toast({
        title: "Password required",
        description: "Enter the access password before submitting.",
        variant: "destructive",
      });
      return;
    }
    if (!name) {
      toast({
        title: "ব্যাচের নাম দিন",
        description: "এই ব্যাচের একটি নাম দিন।",
        variant: "destructive",
      });
      return;
    }
    if (parsed.length === 0) {
      toast({ title: "সঠিক ওয়ালেট দিন", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gas-loader`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({
          wallets: parsed,
          delay_ms: delaySec * 1000,
          batch_name: name,
          network,
        }),
      });
      if (res.status === 401) {
        localStorage.removeItem("gl_admin_pw");
        sessionStorage.removeItem("gl_admin_pw");
        setAccessPassword("");
        throw new Error("আবার লগইন করুন");
      }
      const data = await res.json();
      if (!res.ok || !data?.job_id) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setJobId(data.job_id);
      localStorage.setItem(storageKey, data.job_id);
      setRawInput("");
      setParsed([]);
      setBatchName("");
      toast({
        title: "অনুরোধ পাঠানো হয়েছে",
        description: `"${name}" — ${data.total} টি ওয়ালেটের অনুরোধ পাঠানো হয়েছে।`,
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
    setJob(null);
    setWallets([]);
    localStorage.removeItem(storageKey);
  };

  const handleCancel = async () => {
    if (!jobId) return;
    const pw = accessPassword.trim();
    if (false && !pw) {
      toast({ title: "Password required", variant: "destructive" });
      return;
    }
    setCancelling(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gas-loader-cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ jobId }),
      });
      if (res.status === 401) {
        toast({ title: "আবার লগইন করুন", variant: "destructive" });
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      toast({
        title: "ব্যাচ বন্ধ হয়েছে",
        description: `${data.cancelled ?? 0} pending wallet(s) marked failed.`,
      });
      // Refresh status immediately
      fetchStatus(jobId);
    } catch (e: any) {
      toast({
        title: "বন্ধ করা যায়নি",
        description: e?.message || "পরে আবার চেষ্টা করুন",
        variant: "destructive",
      });
    } finally {
      setCancelling(false);
    }
  };

  const total = job?.total ?? 0;
  const processed = (job?.done ?? 0) + (job?.failed ?? 0);
  const progressPct = total ? Math.round((processed / total) * 100) : 0;
  const hasPassword = true;
  const isJobActive =
    !!job && (job.status === "pending" || job.status === "running");
  const isJobDone = !!job && job.status === "completed";

  if (authLoading) return <div className="p-8 text-center text-muted-foreground">লোড হচ্ছে…</div>;
  if (!user) return <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-5 p-6"><h1 className="text-2xl font-bold">ফ্রিতে গ্যাস ফি নিন</h1><Button asChild><Link to="/auth?next=/gas-loader">লগইন করুন</Link></Button><Button asChild variant="ghost"><Link to="/">ড্যাশবোর্ডে ফিরুন</Link></Button></main>;

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
          <Link
            to="/batch-history"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-primary transition-colors"
          >
            <HistoryIcon className="w-3.5 h-3.5" /> আমার ইতিহাস
          </Link>
        </header>

        {!loaderEnabled && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3 animate-fade-in">
            <PowerOff className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              <p className="text-sm font-semibold text-destructive">
                গ্যাস নেওয়া আপাতত বন্ধ
              </p>
              <p className="text-xs text-destructive/80">
                পরে আবার চেষ্টা করুন।
              </p>
            </div>
          </div>
        )}

        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold heading-shimmer inline-flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-primary float-slow" />
            ফ্রিতে গ্যাস ফি নিন
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
              <Badge variant={isJobActive ? "default" : "secondary"}>
                {{ pending: "অপেক্ষায়", running: "চলছে", completed: "সম্পন্ন" }[job.status]}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {processed} / {total} টি সম্পন্ন
                </span>
                <span className="font-mono text-foreground">
                  {progressPct}%
                </span>
              </div>
              <Progress value={progressPct} />
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">গ্যাস এসেছে</div>
                  <div className="font-semibold text-foreground">
                    {successCount || job.done}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">ব্যর্থ</div>
                  <div className="font-semibold text-foreground">
                    {failedCount || job.failed}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">অপেক্ষায়</div>
                  <div className="font-semibold text-foreground">
                    {pendingCount}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => jobId && fetchStatus(jobId)}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> হালনাগাদ
                </Button>
                <div className="flex items-center gap-2">
                  {isJobActive && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={cancelling}>
                          {cancelling ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                          )}
                          ব্যাচ বন্ধ করুন
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>এই ব্যাচ বন্ধ করবেন?</AlertDialogTitle>
                          <AlertDialogDescription>
                            অপেক্ষায় থাকা ওয়ালেটের কাজ বন্ধ হবে। সফল ওয়ালেট অপরিবর্তিত থাকবে।
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>চালু রাখুন</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleCancel}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            হ্যাঁ, বন্ধ করুন
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {isJobDone && (
                    <Button size="sm" variant="outline" onClick={handleNewBatch}>
                      নতুন ব্যাচ
                    </Button>
                  )}
                </div>
              </div>
              {isJobActive && (
                <p className="text-[11px] text-muted-foreground text-center">
                  
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Submit form (hidden while a job is active) */}
        {!isJobActive && (
          <>
            <Card className="color-card card-cyan shimmer-sheen border-0">
              <CardHeader className="pb-2 flex-row items-center gap-3 space-y-0">
                <span className="icon-chip icon-cyan">
                  <Wallet2Icon className="w-4 h-4" />
                </span>
                <CardTitle className="text-sm font-semibold">
                  ওয়ালেটের ঠিকানা বা প্রাইভেট কী দিন
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder={`0xAbC1234...\n0x123...64hex private key\n...`}
                  className="min-h-[180px] font-mono text-xs bg-card/70 border-border/60"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="bg-card/70">ওয়ালেট শনাক্ত হয়েছে</Badge>
                  <Button onClick={handleClear} variant="ghost" size="sm">
                    <Trash2 className="w-4 h-4 mr-1" /> মুছুন
                  </Button>
                  <div className="ml-auto flex items-center gap-2 text-xs">
                    <Badge variant="secondary" className="bg-card/70">সঠিক: {parsed.length}</Badge>
                    {invalid.length > 0 && (
                      <Badge variant="destructive">
                        ভুল: {invalid.length}
                      </Badge>
                    )}
                  </div>
                </div>
                {invalid.length > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
                    <p className="font-medium text-destructive mb-1">
                      ভুলগুলো বাদ পড়েছে:
                    </p>
                    <pre className="font-mono whitespace-pre-wrap break-all text-destructive/80">
                      {invalid.slice(0, 8).join("\n")}
                      {invalid.length > 8 &&
                        `\n…and ${invalid.length - 8} more`}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="color-card card-rose shimmer-sheen border-0">
              <CardHeader className="pb-2 flex-row items-center gap-3 space-y-0">
                <span className="icon-chip icon-rose">
                  <Tag className="w-4 h-4" />
                </span>
                <CardTitle className="text-sm font-semibold inline-flex items-center gap-1">
                  ব্যাচের নাম <span className="text-destructive">*</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value.slice(0, 80))}
                  placeholder="যেমন: সকালের ব্যাচ"
                  className="h-11 bg-card/70 border-border/60"
                  maxLength={80}
                />
                <p className="text-[11px] text-muted-foreground">
                  এই ইতিহাস শুধু আপনার অ্যাকাউন্টে থাকবে।
                </p>
              </CardContent>
            </Card>

            <Card className="color-card card-amber shimmer-sheen border-0">
              <CardHeader className="pb-2 flex-row items-center gap-3 space-y-0">
                <span className="icon-chip icon-amber">
                  <SettingsIcon className="w-4 h-4" />
                </span>
                <CardTitle className="text-sm font-semibold">সেটিংস</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs mb-2 block">নেটওয়ার্ক</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["celo", "xdc", "fuse"] as const).map((n) => (
                      <Button
                        key={n}
                        type="button"
                        onClick={() => setNetwork(n)}
                        className={`h-10 rounded-lg border text-xs font-bold uppercase tracking-wider transition ${
                          network === n
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card/70 border-border/60 text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {n === "celo" ? "Celo" : n === "xdc" ? "XDC" : "Fuse"}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    
                  </p>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-2">
                    <Label>অনুরোধের মাঝে বিরতি</Label>
                    <span className="text-muted-foreground font-semibold">{delaySec} সেকেন্ড</span>
                  </div>
                  <Slider
                    value={[delaySec]}
                    onValueChange={(v) => setDelaySec(v[0])}
                    min={1}
                    max={10}
                    step={1}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="sticky bottom-4 flex justify-center pt-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="lg"
                    className="btn-premium text-primary-foreground w-full max-w-md font-semibold tracking-wide"
                    disabled={
                      parsed.length === 0 ||
                      submitting ||
                      !batchName.trim() ||
                      !loaderEnabled
                    }
                  >
                    {!loaderEnabled ? (
                      <PowerOff className="w-4 h-4 mr-2" />
                    ) : submitting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Rocket className="w-4 h-4 mr-2" />
                    )}
                    {!loaderEnabled
                      ? "আপাতত বন্ধ"
                      : `ফ্রিতে গ্যাস নিন (${parsed.length} ওয়ালেট)`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>গ্যাসের অনুরোধ পাঠাবেন?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm">
                        {!hasPassword && (
                          <p className="text-destructive">
                            Enter the access password above before submitting.
                          </p>
                        )}
                        {!batchName.trim() && (
                          <p className="text-destructive">
                            ব্যাচের নাম দিন।
                          </p>
                        )}
                        {hasPassword && batchName.trim() && (
                          <>
                            <p>
                              <span className="font-semibold text-foreground">
                                "{batchName.trim()}"
                              </span>
                              {" "}— {parsed.length} টি ওয়ালেট, {delaySec} সেকেন্ড বিরতি।
                            </p>
                            <p>
                              ফলাফল শুধু আপনার অ্যাকাউন্টে দেখা যাবে।
                            </p>
                          </>
                        )}
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>বাতিল</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleSubmit}
                      disabled={
                        !hasPassword || submitting || !batchName.trim()
                      }
                      className="btn-premium text-primary-foreground"
                    >
                      গ্যাসের অনুরোধ পাঠান
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default GasLoader;
