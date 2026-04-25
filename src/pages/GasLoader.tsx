import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
  const [accessPassword, setAccessPassword] = useState<string>(
    () =>
      localStorage.getItem("gl_admin_pw") ||
      sessionStorage.getItem("gl_admin_pw") ||
      ""
  );
  const [rawInput, setRawInput] = useState("");
  const [parsed, setParsed] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [delaySec, setDelaySec] = useState(3);
  const [batchName, setBatchName] = useState("");
  const [loaderEnabled, setLoaderEnabled] = useState<boolean>(true);

  // Active server-side job state
  const [jobId, setJobId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_JOB_KEY)
  );
  const [job, setJob] = useState<Job | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
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
    const pw = accessPassword.trim();
    if (!pw) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gas-loader-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": pw,
        },
        body: JSON.stringify({ job_id: id, include_wallets: true }),
      });
      if (res.status === 401) {
        toast({
          title: "Wrong password",
          description: "Re-enter the access password to resume polling.",
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
        localStorage.removeItem(ACTIVE_JOB_KEY);
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
  }, [jobId, accessPassword]);

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
    if (!pw) {
      toast({
        title: "Password required",
        description: "Enter the access password before submitting.",
        variant: "destructive",
      });
      return;
    }
    if (!name) {
      toast({
        title: "Batch name required",
        description: "Give this batch a name to track it in history.",
        variant: "destructive",
      });
      return;
    }
    if (parsed.length === 0) {
      toast({ title: "No wallets parsed", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gas-loader`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": pw,
        },
        body: JSON.stringify({
          wallets: parsed,
          delay_ms: delaySec * 1000,
          batch_name: name,
        }),
      });
      if (res.status === 401) {
        localStorage.removeItem("gl_admin_pw");
        sessionStorage.removeItem("gl_admin_pw");
        setAccessPassword("");
        throw new Error("Wrong password");
      }
      const data = await res.json();
      if (!res.ok || !data?.job_id) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setJobId(data.job_id);
      localStorage.setItem(ACTIVE_JOB_KEY, data.job_id);
      setRawInput("");
      setParsed([]);
      setBatchName("");
      toast({
        title: "Submitted",
        description: `"${name}" — ${data.total} wallet(s) queued. Runs on the server.`,
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
    localStorage.removeItem(ACTIVE_JOB_KEY);
  };

  const total = job?.total ?? 0;
  const processed = (job?.done ?? 0) + (job?.failed ?? 0);
  const progressPct = total ? Math.round((processed / total) * 100) : 0;
  const hasPassword = Boolean(accessPassword.trim());
  const isJobActive =
    !!job && (job.status === "pending" || job.status === "running");
  const isJobDone = !!job && job.status === "completed";

  return (
    <div className="aurora-bg min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-center justify-between">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Admin
          </Link>
          <Link
            to="/admin/batch-history"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-primary transition-colors"
          >
            <HistoryIcon className="w-3.5 h-3.5" /> History
          </Link>
        </header>

        {!loaderEnabled && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3 animate-fade-in">
            <PowerOff className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              <p className="text-sm font-semibold text-destructive">
                Gas loader is currently disabled
              </p>
              <p className="text-xs text-destructive/80">
                The admin has temporarily turned off this service. Please check back soon.
              </p>
            </div>
          </div>
        )}

        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold heading-shimmer inline-flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-primary float-slow" />
            Batch Gas Loader
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm">
            Server-side queue · runs in background · safe to close this page
          </p>
        </div>

        <Card className="color-card card-violet shimmer-sheen border-0">
          <CardHeader className="pb-2 flex-row items-center gap-3 space-y-0">
            <span className="icon-chip icon-violet">
              <Sparkles className="w-4 h-4" />
            </span>
            <CardTitle className="text-sm font-semibold">
              Access password
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              type="password"
              value={accessPassword}
              onChange={(e) => setAccessPassword(e.target.value)}
              placeholder="Enter password"
              className="h-11 bg-white/70 border-white/60"
            />
          </CardContent>
        </Card>

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
              <Badge variant={isJobActive ? "default" : "secondary"}>
                {job.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {processed} / {total} processed
                </span>
                <span className="font-mono text-foreground">
                  {progressPct}%
                </span>
              </div>
              <Progress value={progressPct} />
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Success</div>
                  <div className="font-semibold text-foreground">
                    {successCount || job.done}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Failed</div>
                  <div className="font-semibold text-foreground">
                    {failedCount || job.failed}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Pending</div>
                  <div className="font-semibold text-foreground">
                    {pendingCount}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => jobId && fetchStatus(jobId)}
                >
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
                  Processing runs on the server. You can close this page or
                  turn off your screen — progress will continue.
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
                  Wallets — paste addresses or private keys
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder={`0xAbC1234...\n0x123...64hex private key\n...`}
                  className="min-h-[180px] font-mono text-xs bg-white/70 border-white/60"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="bg-white/70">Auto parsed</Badge>
                  <Button onClick={handleClear} variant="ghost" size="sm">
                    <Trash2 className="w-4 h-4 mr-1" /> Clear
                  </Button>
                  <div className="ml-auto flex items-center gap-2 text-xs">
                    <Badge variant="secondary" className="bg-white/70">Valid: {parsed.length}</Badge>
                    {invalid.length > 0 && (
                      <Badge variant="destructive">
                        Invalid: {invalid.length}
                      </Badge>
                    )}
                  </div>
                </div>
                {invalid.length > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
                    <p className="font-medium text-destructive mb-1">
                      Invalid lines (skipped):
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
                  Batch name <span className="text-destructive">*</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value.slice(0, 80))}
                  placeholder="e.g. Customer Order #12 or Morning Run"
                  className="h-11 bg-white/70 border-white/60"
                  maxLength={80}
                />
                <p className="text-[11px] text-muted-foreground">
                  Required. Saved permanently in public batch history — search
                  by this name later to see total wallets loaded.
                </p>
              </CardContent>
            </Card>

            <Card className="color-card card-amber shimmer-sheen border-0">
              <CardHeader className="pb-2 flex-row items-center gap-3 space-y-0">
                <span className="icon-chip icon-amber">
                  <SettingsIcon className="w-4 h-4" />
                </span>
                <CardTitle className="text-sm font-semibold">Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between text-xs mb-2">
                  <Label>Delay between requests</Label>
                  <span className="text-muted-foreground font-semibold">{delaySec}s</span>
                </div>
                <Slider
                  value={[delaySec]}
                  onValueChange={(v) => setDelaySec(v[0])}
                  min={1}
                  max={10}
                  step={1}
                />
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
                      ? "Disabled by admin"
                      : `Queue ${parsed.length} Wallet(s)`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Submit batch to server</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm">
                        {!hasPassword && (
                          <p className="text-destructive">
                            Enter the access password above before submitting.
                          </p>
                        )}
                        {!batchName.trim() && (
                          <p className="text-destructive">
                            Enter a batch name above — required for history.
                          </p>
                        )}
                        {hasPassword && batchName.trim() && (
                          <>
                            <p>
                              <span className="font-semibold text-foreground">
                                "{batchName.trim()}"
                              </span>
                              {" "}— {parsed.length} wallet(s), {delaySec}s
                              delay.
                            </p>
                            <p>
                              Runs on the server in the background. Safe to
                              close this page. Saved permanently in public
                              batch history.
                            </p>
                          </>
                        )}
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleSubmit}
                      disabled={
                        !hasPassword || submitting || !batchName.trim()
                      }
                      className="btn-premium text-primary-foreground"
                    >
                      Submit
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
