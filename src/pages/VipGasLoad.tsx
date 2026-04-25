import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Crown, Wallet as WalletIcon, Loader2, Rocket, RefreshCw,
  CheckSquare, Square, Upload, Tag, Sparkles, Fuel, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useWallet } from "@/hooks/useWallet";

const EDGE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;
const ACTIVE_KEY = "vip_gl_active_job";
const POLL_MS = 4000;

type LockedRow = { wallet_address: string; added_at: string };
type MembershipRow = { id: string; package_id: string; expires_at: string };
type Job = {
  id: string;
  total: number;
  done: number;
  failed: number;
  status: string;
  batch_name: string | null;
  delay_ms: number;
  created_at: string;
  finished_at: string | null;
};

export default function VipGasLoad() {
  const wallet = useWallet();
  const nav = useNavigate();
  const [hasMembership, setHasMembership] = useState<boolean | null>(null);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [locked, setLocked] = useState<LockedRow[]>([]);
  const [loadingLocked, setLoadingLocked] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasteInput, setPasteInput] = useState("");
  const [batchName, setBatchName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_KEY),
  );
  const [job, setJob] = useState<Job | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadLocked = useCallback(async () => {
    if (!wallet.address) return;
    setLoadingLocked(true);
    try {
      const r = await fetch(`${EDGE}/vip-gas-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_wallet: wallet.address, action: "locked" }),
      });
      const d = await r.json();
      setHasMembership(!!d.has_membership);
      setLocked(d.wallets || []);
      setMemberships(d.memberships || []);
    } catch {
      toast.error("Failed to load locked wallets");
    }
    setLoadingLocked(false);
  }, [wallet.address]);

  useEffect(() => {
    if (wallet.address) loadLocked();
  }, [wallet.address, loadLocked]);

  // Poll job status
  const fetchStatus = useCallback(async (id: string) => {
    if (!wallet.address) return;
    try {
      const r = await fetch(`${EDGE}/vip-gas-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_wallet: wallet.address, action: "status", job_id: id }),
      });
      const d = await r.json();
      if (d.job) {
        setJob(d.job);
      } else {
        setJob(null);
        setJobId(null);
        localStorage.removeItem(ACTIVE_KEY);
      }
    } catch {/* ignore */}
  }, [wallet.address]);

  useEffect(() => {
    if (!jobId) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    fetchStatus(jobId);
    pollRef.current = window.setInterval(() => fetchStatus(jobId), POLL_MS);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobId, fetchStatus]);

  const filteredLocked = useMemo(() => {
    if (!search.trim()) return locked;
    const q = search.trim().toLowerCase();
    return locked.filter((l) => l.wallet_address.toLowerCase().includes(q));
  }, [locked, search]);

  const toggleOne = (addr: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = addr.toLowerCase();
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = filteredLocked.every((l) => next.has(l.wallet_address.toLowerCase()));
      if (allSelected) {
        for (const l of filteredLocked) next.delete(l.wallet_address.toLowerCase());
      } else {
        for (const l of filteredLocked) next.add(l.wallet_address.toLowerCase());
      }
      return next;
    });
  };

  const parsePaste = (raw: string): { valid: string[]; invalid: number } => {
    const seen = new Set<string>();
    const valid: string[] = [];
    let invalid = 0;
    const lines = raw.split(/[\s,;\n\r]+/).map((s) => s.trim()).filter(Boolean);
    for (const ln of lines) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(ln)) { invalid++; continue; }
      const k = ln.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      valid.push(ln);
    }
    return { valid, invalid };
  };

  const handleSubmit = async (mode: "selected" | "paste") => {
    if (!wallet.address) return;
    const name = batchName.trim();
    if (!name) {
      toast.error("Give this batch a name");
      return;
    }
    let toSend: string[] = [];
    if (mode === "selected") {
      toSend = Array.from(selected);
      if (toSend.length === 0) { toast.error("Select at least one wallet"); return; }
    } else {
      const { valid, invalid } = parsePaste(pasteInput);
      if (valid.length === 0) { toast.error("No valid addresses"); return; }
      if (invalid > 0) toast.message(`${invalid} invalid line(s) skipped`);
      toSend = valid;
    }
    if (toSend.length > 350) {
      toast.error("Max 350 wallets per batch");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${EDGE}/vip-gas-load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_wallet: wallet.address,
          wallets: toSend,
          batch_name: name,
          delay_ms: 3000,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error || "Submit failed");
        if (d.rejected_count) {
          toast.message(`${d.rejected_count} wallet(s) not in your locked list`);
        }
        return;
      }
      setJobId(d.job_id);
      localStorage.setItem(ACTIVE_KEY, d.job_id);
      setSelected(new Set());
      setPasteInput("");
      setBatchName("");
      toast.success(
        `Submitted ${d.total} wallet(s)${d.rejected_not_locked ? ` · ${d.rejected_not_locked} rejected (not locked)` : ""}`,
      );
    } catch {
      toast.error("Network error");
    }
    setSubmitting(false);
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    setPasteInput((prev) => (prev ? prev + "\n" + text : text));
    toast.success(`Loaded ${file.name}`);
  };

  // ---------- Render ----------

  if (!wallet.address) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full p-8 text-center">
          <WalletIcon className="h-10 w-10 mx-auto mb-4 text-primary" />
          <h2 className="text-xl font-bold mb-2">Connect your wallet</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Sign in with your Buy IP membership wallet to load gas.
          </p>
          <Button
            className="w-full"
            onClick={() => wallet.connect().catch((e) => toast.error(e?.message || "Connect failed"))}
            disabled={wallet.connecting}
          >
            {wallet.connecting ? "Connecting…" : "Connect Wallet"}
          </Button>
          <Link to="/vip" className="block mt-4 text-xs text-muted-foreground underline">
            View Buy IP packages
          </Link>
        </Card>
      </div>
    );
  }

  if (hasMembership === false) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full p-8 text-center">
          <Crown className="h-10 w-10 mx-auto mb-4 text-primary" />
          <h2 className="text-xl font-bold mb-2">No active Buy IP membership</h2>
          <p className="text-sm text-muted-foreground mb-6">
            You need an active Buy IP package to use unlimited gas loading.
          </p>
          <Button className="w-full" onClick={() => nav("/vip")}>
            <Crown className="h-4 w-4 mr-2" /> Browse Packages
          </Button>
        </Card>
      </div>
    );
  }

  const total = job?.total ?? 0;
  const processed = (job?.done ?? 0) + (job?.failed ?? 0);
  const pct = total ? Math.round((processed / total) * 100) : 0;
  const isActive = !!job && (job.status === "pending" || job.status === "running");
  const isDone = !!job && job.status === "completed";

  return (
    <div className="aurora-bg min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-center justify-between">
          <Link
            to="/vip/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs px-3 py-1.5 rounded-md bg-muted">
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </span>
            <Button size="sm" variant="ghost" onClick={() => wallet.disconnect()}>
              Logout
            </Button>
          </div>
        </header>

        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold heading-shimmer inline-flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-primary float-slow" />
            Buy IP Gas Load
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm">
            Unlimited gas loads on your locked wallets · server-side queue · safe to close page
          </p>
        </div>

        {/* Active / completed job */}
        {job && (
          <Card className="color-card card-indigo shimmer-sheen border-0">
            <CardHeader className="pb-2 flex-row items-start justify-between space-y-0 gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="icon-chip icon-indigo">
                  <Rocket className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <CardTitle className="text-sm font-semibold">
                    {isDone ? "Last batch — completed" : "Current batch"}
                  </CardTitle>
                  {job.batch_name && (
                    <p className="text-xs text-primary font-medium truncate mt-0.5 inline-flex items-center gap-1">
                      <Tag className="w-3 h-3" /> {job.batch_name}
                    </p>
                  )}
                </div>
              </div>
              <Badge variant={isActive ? "default" : "secondary"}>{job.status}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{processed} / {total} processed</span>
                <span className="font-mono text-foreground">{pct}%</span>
              </div>
              <Progress value={pct} />
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Success</div>
                  <div className="font-semibold text-foreground">{job.done}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Failed</div>
                  <div className="font-semibold text-foreground">{job.failed}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-muted-foreground">Pending</div>
                  <div className="font-semibold text-foreground">{Math.max(0, total - processed)}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="ghost" onClick={() => jobId && fetchStatus(jobId)}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
                </Button>
                {isDone && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setJob(null);
                      setJobId(null);
                      localStorage.removeItem(ACTIVE_KEY);
                    }}
                  >
                    Start new batch
                  </Button>
                )}
              </div>
              {isActive && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Processing runs on the server. You can close this page — progress will continue.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Submit form (hidden while active) */}
        {!isActive && (
          <>
            <Card className="color-card card-violet shimmer-sheen border-0">
              <CardHeader className="pb-2 flex-row items-center gap-3 space-y-0">
                <span className="icon-chip icon-violet">
                  <Tag className="w-4 h-4" />
                </span>
                <CardTitle className="text-sm font-semibold">Batch name</CardTitle>
              </CardHeader>
              <CardContent>
                <Input
                  placeholder="e.g. Batch 1, April load…"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  maxLength={80}
                  className="h-11 bg-white/70 border-white/60"
                />
              </CardContent>
            </Card>

            <Tabs defaultValue="select" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="select">
                  <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
                  Select from locked ({locked.length})
                </TabsTrigger>
                <TabsTrigger value="paste">
                  <Fuel className="w-3.5 h-3.5 mr-1.5" />
                  Paste / Upload
                </TabsTrigger>
              </TabsList>

              {/* SELECT TAB */}
              <TabsContent value="select" className="mt-3">
                <Card className="color-card card-cyan shimmer-sheen border-0">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold">Your locked wallets</CardTitle>
                      <Button size="sm" variant="ghost" onClick={loadLocked} disabled={loadingLocked}>
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingLocked ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {locked.length === 0 ? (
                      <div className="text-center py-6 space-y-3">
                        <p className="text-sm text-muted-foreground">
                          No locked wallets yet. Lock some wallets first to load gas on them.
                        </p>
                        <Link to="/vip/dashboard">
                          <Button size="sm" variant="outline">Go to Dashboard</Button>
                        </Link>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Search address…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-8 h-9 bg-white/70 border-white/60 text-xs"
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 text-foreground/80 hover:text-primary"
                            onClick={toggleAllVisible}
                          >
                            <Square className="w-3.5 h-3.5" />
                            Toggle all visible ({filteredLocked.length})
                          </button>
                          <Badge variant="secondary" className="bg-white/70">
                            Selected: {selected.size}
                          </Badge>
                        </div>
                        <div className="max-h-72 overflow-y-auto rounded-lg border border-white/40 bg-white/40 divide-y divide-white/40">
                          {filteredLocked.map((l) => {
                            const k = l.wallet_address.toLowerCase();
                            const checked = selected.has(k);
                            return (
                              <button
                                key={l.wallet_address}
                                type="button"
                                onClick={() => toggleOne(l.wallet_address)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-mono hover:bg-white/60 transition-colors ${
                                  checked ? "bg-primary/10" : ""
                                }`}
                              >
                                {checked ? (
                                  <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                                ) : (
                                  <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                                )}
                                <span className="truncate">{l.wallet_address}</span>
                              </button>
                            );
                          })}
                          {filteredLocked.length === 0 && (
                            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                              No matches.
                            </div>
                          )}
                        </div>
                        <Button
                          className="w-full"
                          onClick={() => handleSubmit("selected")}
                          disabled={submitting || selected.size === 0 || !batchName.trim()}
                        >
                          {submitting ? (
                            <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Submitting…</>
                          ) : (
                            <><Rocket className="w-4 h-4 mr-2" /> Load Gas on {selected.size} wallet(s)</>
                          )}
                        </Button>
                        <p className="text-[11px] text-muted-foreground text-center">
                          Max 350 per batch. Only your locked wallets can be loaded.
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* PASTE TAB */}
              <TabsContent value="paste" className="mt-3">
                <Card className="color-card card-cyan shimmer-sheen border-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Paste addresses or upload file</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        id="vip-gl-file"
                        accept=".txt,.csv"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                      />
                      <label htmlFor="vip-gl-file">
                        <Button size="sm" variant="outline" asChild>
                          <span className="cursor-pointer">
                            <Upload className="h-3.5 w-3.5 mr-1" /> Upload .txt / .csv
                          </span>
                        </Button>
                      </label>
                      <span className="text-xs text-muted-foreground">or paste below</span>
                    </div>
                    <Textarea
                      placeholder={`0xAbC1234...\n0x456...\n…`}
                      value={pasteInput}
                      onChange={(e) => setPasteInput(e.target.value)}
                      className="min-h-[180px] font-mono text-xs bg-white/70 border-white/60"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Only addresses already in your <Link to="/vip/dashboard" className="underline text-primary">locked list</Link> will be processed. Others will be silently rejected.
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => handleSubmit("paste")}
                      disabled={submitting || !pasteInput.trim() || !batchName.trim()}
                    >
                      {submitting ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Submitting…</>
                      ) : (
                        <><Rocket className="w-4 h-4 mr-2" /> Submit batch</>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}

        {memberships.length > 0 && (
          <div className="text-center text-[11px] text-muted-foreground">
            Active memberships: {memberships.length} · Total locked wallets: {locked.length}
          </div>
        )}
      </div>
    </div>
  );
}
