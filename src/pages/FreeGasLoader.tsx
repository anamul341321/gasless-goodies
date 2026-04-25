import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Wallet } from "ethers";
import { ArrowLeft, Crown, Fuel, Loader2, Rocket, Trash2, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/deviceId";

const EDGE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;
const POLL_MS = 4000;
const ACTIVE_KEY = "free_gas_active_job";
const HISTORY_KEY = "free_gas_loaded_history"; // { date: 'YYYY-MM-DD', wallets: string[] }

function loadHistoryToday(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (parsed?.date !== today) return [];
    return Array.isArray(parsed.wallets) ? parsed.wallets : [];
  } catch { return []; }
}

function saveHistoryToday(wallets: string[]) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const existing = loadHistoryToday();
    const merged = Array.from(new Set([...existing, ...wallets.map((w) => w.toLowerCase())]));
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ date: today, wallets: merged }));
  } catch {}
}

type WalletRow = {
  wallet_address: string;
  status: "pending" | "processing" | "success" | "failed";
  tx_hash: string | null;
  error_message: string | null;
  processed_at: string | null;
};

type Job = {
  id: string;
  total: number;
  done: number;
  failed: number;
  status: "pending" | "running" | "completed";
  batch_name: string;
  created_at: string;
  finished_at: string | null;
};

function parseInput(raw: string): { addresses: string[]; invalid: string[] } {
  const addresses: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/[\s,;\n\r]+/).map((l) => l.trim()).filter(Boolean)) {
    let addr: string | null = null;
    if (/^0x[a-fA-F0-9]{40}$/.test(line)) addr = line;
    else if (/^(0x)?[a-fA-F0-9]{64}$/.test(line)) {
      try { addr = new Wallet(line.startsWith("0x") ? line : "0x" + line).address; }
      catch { invalid.push(line); continue; }
    } else { invalid.push(line); continue; }
    const k = addr.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    addresses.push(addr);
  }
  return { addresses, invalid };
}

export default function FreeGasLoader() {
  const { toast } = useToast();
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [job, setJob] = useState<Job | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [usage, setUsage] = useState({ used: 0, remaining: 2, limit: 2 });
  const [loaderEnabled, setLoaderEnabled] = useState(true);
  const pollRef = useRef<number | null>(null);

  // Live admin toggle
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.rpc("get_safe_admin_settings");
      if (!mounted) return;
      const row = Array.isArray(data) ? data[0] : null;
      if (row && typeof row.gas_loader_enabled === "boolean") setLoaderEnabled(row.gas_loader_enabled);
    })();
    const ch = supabase
      .channel("free-gas-admin-flag")
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_settings" }, (p: any) => {
        const next = p?.new?.gas_loader_enabled;
        if (typeof next === "boolean") setLoaderEnabled(next);
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    if (jobId) return;
    const r = parseInput(raw);
    setParsed(r.addresses);
    setInvalid(r.invalid);
  }, [raw, jobId]);

  const fetchStatus = async (id: string | null) => {
    try {
      const knownWallets = loadHistoryToday();
      const deviceId = await getDeviceId();
      const payload: any = { wallets: knownWallets, device_id: deviceId };
      if (id) payload.job_id = id;
      const r = await fetch(`${EDGE}/free-gas-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return;
      const d = await r.json();
      setUsage({ used: d.used_today ?? 0, remaining: d.remaining ?? 0, limit: d.limit ?? 2 });
      if (d.job) {
        setJob(d.job);
        setWallets(d.wallets || []);
      } else if (id) {
        // Job not found; clear
        setJob(null);
        setWallets([]);
        setJobId(null);
        localStorage.removeItem(ACTIVE_KEY);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus(jobId);
    if (pollRef.current) clearInterval(pollRef.current);
    if (jobId) {
      pollRef.current = window.setInterval(() => fetchStatus(jobId), POLL_MS);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const successCount = useMemo(() => wallets.filter((w) => w.status === "success").length, [wallets]);
  const failedCount = useMemo(() => wallets.filter((w) => w.status === "failed").length, [wallets]);
  const pendingCount = useMemo(() => wallets.filter((w) => w.status === "pending" || w.status === "processing").length, [wallets]);

  const handleSubmit = async () => {
    if (parsed.length === 0) { toast({ title: "No wallets parsed", variant: "destructive" }); return; }
    if (parsed.length > usage.remaining) {
      toast({
        title: `Daily limit: ${usage.limit}/day`,
        description: `You can submit only ${usage.remaining} more wallets today. The first ${usage.remaining} will be queued.`,
      });
    }
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      const r = await fetch(`${EDGE}/free-gas-load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallets: parsed, device_id: deviceId }),
      });
      const d = await r.json();
      if (r.status === 429) {
        toast({ title: "Daily limit reached", description: d.message, variant: "destructive" });
      } else if (!r.ok) {
        toast({ title: "Submit failed", description: d.error || `HTTP ${r.status}`, variant: "destructive" });
      } else {
        setJobId(d.job_id);
        localStorage.setItem(ACTIVE_KEY, d.job_id);
        // Remember submitted wallets for today so the limit follows the browser even if IP changes
        saveHistoryToday(parsed.slice(0, d.total ?? parsed.length));
        setRaw("");
        setParsed([]);
        toast({ title: "Queued", description: d.message || `${d.total} wallet(s) submitted.` });
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e?.message || "", variant: "destructive" });
    }
    setSubmitting(false);
  };

  const handleNew = () => {
    setJobId(null);
    setJob(null);
    setWallets([]);
    localStorage.removeItem(ACTIVE_KEY);
  };

  const total = job?.total ?? 0;
  const processed = (job?.done ?? 0) + (job?.failed ?? 0);
  const pct = total ? Math.round((processed / total) * 100) : 0;
  const isActive = !!job && (job.status === "pending" || job.status === "running");
  const isDone = !!job && job.status === "completed";

  return (
    <div className="aurora-bg min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-5">
        <header className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
          <Link to="/vip" className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline">
            <Crown className="w-3.5 h-3.5" /> Buy IP — Unlimited
          </Link>
        </header>

        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold heading-shimmer inline-flex items-center gap-2">
            <Fuel className="w-7 h-7 text-primary float-slow" /> Free Gas Loader
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm">
            Load gas on Celo wallets · {usage.limit} free wallets per day per IP
          </p>
        </div>

        {!loaderEnabled && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive font-semibold">
            Gas loader is currently disabled by admin. Please check back soon.
          </div>
        )}

        {/* Usage card */}
        <Card className="color-card card-amber shimmer-sheen border-0">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Today's free usage</p>
              <p className="text-lg font-bold">
                {usage.used} / {usage.limit}{" "}
                <span className="text-xs font-medium text-muted-foreground">used</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Remaining</p>
              <p className="text-2xl font-extrabold text-primary">{usage.remaining}</p>
            </div>
          </CardContent>
        </Card>

        {usage.remaining === 0 && !isActive && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="p-4 text-center space-y-2">
              <Crown className="w-6 h-6 text-primary mx-auto" />
              <p className="text-sm font-bold">Daily limit reached</p>
              <p className="text-xs text-muted-foreground">
                Upgrade to Buy IP — lock 300+ wallets and load unlimited times.
              </p>
              <Link to="/vip">
                <Button size="sm" className="mt-1">Buy IP from $17</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Active job */}
        {job && (
          <Card className="color-card card-indigo shimmer-sheen border-0">
            <CardHeader className="pb-2 flex-row items-start justify-between space-y-0 gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="icon-chip icon-indigo"><Rocket className="w-4 h-4" /></span>
                <CardTitle className="text-sm font-semibold">
                  {isDone ? "Last batch — completed" : "Current batch"}
                </CardTitle>
              </div>
              <Badge variant={isActive ? "default" : "secondary"}>{job.status}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{processed} / {total} processed</span>
                <span className="font-mono">{pct}%</span>
              </div>
              <Progress value={pct} />
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Success</div>
                  <div className="font-semibold">{successCount || job.done}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Failed</div>
                  <div className="font-semibold">{failedCount || job.failed}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Pending</div>
                  <div className="font-semibold">{pendingCount}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="ghost" onClick={() => fetchStatus(jobId)}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
                </Button>
                {isDone && (
                  <Button size="sm" variant="outline" onClick={handleNew}>Done</Button>
                )}
              </div>
              {isActive && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Processing runs on the server — you can close this page.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Submit form */}
        {!isActive && usage.remaining > 0 && loaderEnabled && (
          <Card className="color-card card-cyan shimmer-sheen border-0">
            <CardHeader className="pb-2 flex-row items-center gap-3 space-y-0">
              <span className="icon-chip icon-cyan"><Sparkles className="w-4 h-4" /></span>
              <CardTitle className="text-sm font-semibold">
                Wallets — paste addresses (max {usage.remaining} today)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={`0xAbC1234...\n0xDef5678...`}
                className="min-h-[140px] font-mono text-xs bg-white/70 border-white/60"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => { setRaw(""); setParsed([]); setInvalid([]); }} variant="ghost" size="sm">
                  <Trash2 className="w-4 h-4 mr-1" /> Clear
                </Button>
                <div className="ml-auto flex items-center gap-2 text-xs">
                  <Badge variant="secondary" className="bg-white/70">Valid: {parsed.length}</Badge>
                  {invalid.length > 0 && <Badge variant="destructive">Invalid: {invalid.length}</Badge>}
                </div>
              </div>
              <Button
                onClick={handleSubmit}
                disabled={submitting || parsed.length === 0 || !loaderEnabled}
                className="w-full h-11"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
                ) : (
                  <>Load Gas ({Math.min(parsed.length, usage.remaining)})</>
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Need more? <Link to="/vip" className="text-primary font-bold hover:underline">Buy IP</Link> for unlimited loads.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
