import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Eye, EyeOff, Trash2, Copy, RefreshCw, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Network = "celo" | "xdc";

type SavedWallet = { id: string; wallet_address: string; label: string | null; is_active: boolean; network: Network; created_at: string };
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
  network: Network;
  phase: string;
  total: number;
  success: number;
  failed_gas: number;
  failed_other: number;
  final_failed: number;
  started_at: string;
  gas_requests_done_at: string | null;
  finished_at: string | null;
};
type FailedKey = { wallet_address: string; private_key: string; status: string; error?: string };
type NetState = { run: Run | null; items: RunItem[]; failed_keys: FailedKey[] };

function shortAddr(a: string) {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function phaseLabel(p: string | undefined) {
  switch (p) {
    case "claiming": return "ক্লেম হচ্ছে";
    case "gas_requesting": return "গ্যাস রিকোয়েস্ট হচ্ছে";
    case "waiting_30m": return "৩০ মিনিট অপেক্ষা";
    case "retrying": return "আবার চেষ্টা হচ্ছে";
    case "completed": return "সম্পন্ন";
    default: return "শুরু হয়নি";
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
  const [activeNet, setActiveNet] = useState<Network>("celo");
  const [wallets, setWallets] = useState<SavedWallet[]>([]);
  const [walletCounts, setWalletCounts] = useState<Record<Network, number>>({ celo: 0, xdc: 0 });
  const [netState, setNetState] = useState<Record<Network, NetState>>({
    celo: { run: null, items: [], failed_keys: [] },
    xdc: { run: null, items: [], failed_keys: [] },
  });
  const [serverNow, setServerNow] = useState<string>("");
  const [tickNow, setTickNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTickNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const [pasteText, setPasteText] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [shownKeys, setShownKeys] = useState<Record<string, boolean>>({});
  const [showFailedBox, setShowFailedBox] = useState(true);
  const [settings, setSettings] = useState<Record<Network, { hour: number; minute: number; enabled: boolean; waitMin: number }>>({
    celo: { hour: 0, minute: 0, enabled: true, waitMin: 30 },
    xdc: { hour: 0, minute: 0, enabled: true, waitMin: 30 },
  });
  const [savingTime, setSavingTime] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/auth");
  }, [user, loading, navigate]);

  async function fetchAll() {
    if (!user) return;
    setRefreshing(true);
    try {
      const [walletsRes, statusRes, settingsRes] = await Promise.all([
        supabase.functions.invoke("daily-claim-wallets"),
        supabase.functions.invoke("daily-claim-status"),
        supabase.functions.invoke("daily-claim-wallets?action=get_settings"),
      ]);
      if (walletsRes.data?.wallets) setWallets(walletsRes.data.wallets);
      if (statusRes.data) {
        if (statusRes.data.wallet_counts) setWalletCounts(statusRes.data.wallet_counts);
        if (statusRes.data.networks) setNetState(statusRes.data.networks);
        setServerNow(statusRes.data.server_time || "");
      }
      if (settingsRes.data?.settings) {
        setSettings((prev) => {
          const next = { ...prev };
          for (const s of settingsRes.data.settings) {
            const net = (s.network === "xdc" ? "xdc" : "celo") as Network;
            next[net] = { hour: s.start_hour_bd ?? 0, minute: s.start_minute_bd ?? 0, enabled: s.enabled !== false };
          }
          return next;
        });
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function saveTime(net: Network) {
    setSavingTime(true);
    try {
      const s = settings[net];
      const { error } = await supabase.functions.invoke("daily-claim-wallets?action=set_settings", {
        body: { network: net, start_hour_bd: s.hour, start_minute_bd: s.minute, enabled: s.enabled },
      });
      if (error) throw error;
      toast({ title: `Saved ${net.toUpperCase()} start time: ${String(s.hour).padStart(2,"0")}:${String(s.minute).padStart(2,"0")} BD` });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSavingTime(false);
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
        body: { private_keys: lines, network: activeNet },
      });
      if (error) throw error;
      toast({
        title: `Added ${data?.added ?? 0} wallets to ${activeNet.toUpperCase()}`,
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

  async function deleteAllInActive() {
    if (!confirm(`Remove ALL saved ${activeNet.toUpperCase()} wallets?`)) return;
    await supabase.functions.invoke("daily-claim-wallets?action=delete", { body: { all: true, network: activeNet } });
    fetchAll();
  }

  function copy(text: string, label = "Copied") {
    navigator.clipboard.writeText(text).then(() => toast({ title: label }));
  }

  const state = netState[activeNet];
  const run = state.run;
  const items = state.items;
  const failedKeys = state.failed_keys;
  const visibleWallets = wallets.filter((w) => (w.network || "celo") === activeNet);

  function copyAllFailed() {
    if (failedKeys.length === 0) return;
    const txt = failedKeys.map((k) => k.private_key).join("\n");
    copy(txt, `Copied ${failedKeys.length} failed keys`);
  }

  // Time until next scheduled run for active network (BD time = UTC+6)
  const countdown = useMemo(() => {
    const s = settings[activeNet];
    const now = new Date(tickNow);
    const targetUtcMin = ((s.hour * 60 + s.minute) - 360 + 1440) % 1440;
    const nowSec = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
    let diff = targetUtcMin * 60 - nowSec;
    if (diff <= 0) diff += 86400;
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const sec = diff % 60;
    return `${h}h ${String(m).padStart(2,"0")}m ${String(sec).padStart(2,"0")}s`;
  }, [tickNow, settings, activeNet]);

  const waitRemaining = useMemo(() => {
    if (!run || run.phase !== "waiting_30m" || !run.gas_requests_done_at) return null;
    const endsAt = new Date(run.gas_requests_done_at).getTime() + 30 * 60_000;
    const left = Math.max(0, endsAt - tickNow);
    const totalSec = Math.ceil(left / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return { m, s, text: `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` };
  }, [run, tickNow]);

  if (loading) return <div className="p-8 text-center text-muted-foreground">লোড হচ্ছে…</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← হোম</Link>
            <h1 className="text-2xl font-bold mt-1">প্রতিদিনের অটো-ক্লেম</h1>
            <p className="text-sm text-muted-foreground">
              প্রতিদিন আপনার সেট করা বাংলাদেশ সময়ে স্বয়ংক্রিয়ভাবে চলবে · একবার কী সেভ করলে আর পেস্ট করতে হবে না
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} /> রিফ্রেশ
          </Button>
        </header>

        {/* Premium countdown hero */}
        <Card className="relative overflow-hidden border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-background to-sky-500/10 shadow-[0_8px_40px_-12px_hsl(var(--primary)/0.4)]">
          <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.25),transparent_60%)]" />
          <CardContent className="relative p-5 sm:p-7 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-xs sm:text-sm uppercase tracking-[0.2em] text-muted-foreground">
              <Clock className="w-4 h-4" /> পরবর্তী <span className="text-foreground font-semibold">{activeNet.toUpperCase()}</span> অটো-ক্লেম শুরু হবে
            </div>
            <div className="font-mono font-black tabular-nums text-emerald-400 leading-none tracking-tight text-5xl sm:text-6xl md:text-7xl drop-shadow-[0_4px_24px_hsl(142_70%_45%/0.45)]">
              {countdown}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              ঘণ্টা · মিনিট · সেকেন্ড — বাংলাদেশ সময় অনুযায়ী
            </p>
          </CardContent>
        </Card>

        <Tabs value={activeNet} onValueChange={(v) => setActiveNet(v as Network)}>
          <TabsList className="grid grid-cols-2 w-full max-w-xs">
            <TabsTrigger value="celo">Celo ({walletCounts.celo})</TabsTrigger>
            <TabsTrigger value="xdc">XDC ({walletCounts.xdc})</TabsTrigger>
          </TabsList>

          {(["celo", "xdc"] as Network[]).map((net) => (
            <TabsContent key={net} value={net} className="space-y-6 mt-4">
              {/* Schedule */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-4 h-4" /> প্রতিদিনের শুরুর সময় — {net.toUpperCase()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    বাংলাদেশ সময় বেছে নিন কখন প্রতিদিন অটো-ক্লেম শুরু হবে। একবার সেভ করলে প্রতিদিন এই সময়ে সব সেভ করা {net.toUpperCase()} ওয়ালেট স্বয়ংক্রিয়ভাবে ক্লেম হবে — কী পেস্ট করার দরকার নেই।
                  </p>
                  <div className="rounded-md bg-muted/40 border border-border/40 p-2 text-xs text-muted-foreground">
                    <b className="text-foreground">উদাহরণ:</b> রাত ১২টায় শুরু করতে চাইলে <b className="text-foreground">12:00 AM</b> বেছে নিন। দুপুর ১:৩০-এর জন্য <b className="text-foreground">1:30 PM</b>।
                  </div>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="flex flex-col">
                      <label className="text-xs text-muted-foreground mb-1">শুরুর সময় (বাংলাদেশ)</label>
                      <Input
                        type="time"
                        step={60}
                        value={`${String(settings[net].hour).padStart(2,"0")}:${String(settings[net].minute).padStart(2,"0")}`}
                        onChange={(e) => {
                          const [h, m] = (e.target.value || "00:00").split(":").map((x) => Number(x) || 0);
                          setSettings((s) => ({ ...s, [net]: { ...s[net], hour: Math.max(0, Math.min(23, h)), minute: Math.max(0, Math.min(59, m)) } }));
                        }}
                        className="w-40 text-base"
                      />
                    </div>
                    <div className="flex items-center gap-2 pb-2">
                      <Switch
                        checked={settings[net].enabled}
                        onCheckedChange={(v) => setSettings((s) => ({ ...s, [net]: { ...s[net], enabled: v } }))}
                      />
                      <span className="text-xs text-muted-foreground">চালু</span>
                    </div>
                    <Button size="sm" onClick={() => saveTime(net)} disabled={savingTime} className="mb-1">
                      {savingTime ? "সেভ হচ্ছে…" : "সময় সেভ করুন"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    সেভ করা সময়: <span className="text-foreground font-medium">{(() => {
                      const h = settings[net].hour; const m = settings[net].minute;
                      const ampm = h >= 12 ? "PM" : "AM";
                      const h12 = h % 12 === 0 ? 12 : h % 12;
                      return `${h12}:${String(m).padStart(2,"0")} ${ampm} (${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}) BD`;
                    })()}</span>
                    {!settings[net].enabled && <span className="ml-2 text-amber-400">(বন্ধ)</span>}
                  </p>
                </CardContent>
              </Card>

              {/* Today's run */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between">
                    <span>আজকের রান — {net.toUpperCase()}</span>
                    <Badge variant="outline">{phaseLabel(netState[net].run?.phase)}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!netState[net].run ? (
                    <p className="text-sm text-muted-foreground">
                      আজ এখনো কোনো রান হয়নি। পরবর্তী অটো-ক্লেমের জন্য <b className="text-foreground">{walletCounts[net]}</b> টি সক্রিয় ওয়ালেট প্রস্তুত।
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                        <Stat label="মোট" value={netState[net].run!.total} />
                        <Stat label="সফল" value={netState[net].run!.success} tone="text-emerald-400" />
                        <Stat label="গ্যাস দরকার" value={netState[net].run!.failed_gas} tone="text-amber-400" />
                        <Stat label="অন্য ব্যর্থ" value={netState[net].run!.failed_other} tone="text-rose-400" />
                        <Stat label="ফাইনাল ব্যর্থ" value={netState[net].run!.final_failed} tone="text-rose-400" />
                      </div>
                      {netState[net].run!.phase === "claiming" && (
                        <div className="p-3 rounded-md bg-sky-500/10 border border-sky-500/30 text-sm">
                          ক্লেম চলছে — ওয়ালেটগুলো ধীরে ধীরে প্রসেস হচ্ছে।
                        </div>
                      )}
                      {(netState[net].run!.phase === "gas_requesting" || netState[net].run!.phase === "waiting_30m") && (() => {
                        const gasItems = netState[net].items.filter((x) => x.phase1_status === "failed_gas");
                        const gTotal = gasItems.length;
                        const gDone = gasItems.filter((x) => x.gas_request_status === "done").length;
                        const gErr = gasItems.filter((x) => x.gas_request_status === "error").length;
                        const gPending = gasItems.filter((x) => !x.gas_request_status || x.gas_request_status === "requested").length;
                        const pct = gTotal > 0 ? Math.round(((gDone + gErr) / gTotal) * 100) : 0;
                        return (
                          <div className="p-4 rounded-lg bg-gradient-to-br from-amber-500/15 via-background to-orange-500/10 border border-amber-500/40 space-y-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="text-sm font-semibold text-amber-300">
                                ⛽ গ্যাস লোড ব্যাচ চলছে
                              </div>
                              <Badge variant="outline" className="text-amber-300 border-amber-500/40">{pct}%</Badge>
                            </div>
                            <div className="grid grid-cols-4 gap-2 text-center">
                              <Stat label="মোট" value={gTotal} />
                              <Stat label="সফল" value={gDone} tone="text-emerald-400" />
                              <Stat label="ব্যর্থ" value={gErr} tone="text-rose-400" />
                              <Stat label="বাকি" value={gPending} tone="text-amber-400" />
                            </div>
                            <div className="h-2 w-full bg-muted/40 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {netState[net].run!.phase === "gas_requesting"
                                ? "গ্যাস লোড সম্পন্ন হওয়ার পর ৩০ মিনিট অপেক্ষা শুরু হবে, এরপর রিট্রাই ক্লেম।"
                                : "গ্যাস লোড সম্পন্ন। এখন ৩০ মিনিট অপেক্ষা — তারপর রিট্রাই ক্লেম।"}
                            </div>
                          </div>
                        );
                      })()}
                      {netState[net].run!.phase === "waiting_30m" && net === activeNet && waitRemaining !== null && (
                        <div className="p-4 rounded-lg bg-gradient-to-br from-amber-500/15 via-background to-orange-500/10 border border-amber-500/40 text-center space-y-2">
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">গ্যাস আসার অপেক্ষায়</div>
                          <div className="font-mono font-black tabular-nums text-amber-400 text-4xl sm:text-5xl leading-none drop-shadow-[0_4px_18px_hsl(38_92%_50%/0.45)]">
                            {waitRemaining.text}
                          </div>
                          <div className="text-xs text-muted-foreground">মিনিট : সেকেন্ড — এরপর স্বয়ংক্রিয়ভাবে আবার ক্লেম শুরু হবে</div>
                        </div>
                      )}
                      {netState[net].run!.phase === "retrying" && (
                        <div className="p-3 rounded-md bg-sky-500/10 border border-sky-500/30 text-sm">
                          আবার চেষ্টা চলছে — গ্যাস আসার পর বাকি ওয়ালেটগুলো ক্লেম হচ্ছে।
                        </div>
                      )}
                      {netState[net].run!.phase === "completed" && (
                        <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-sm">
                          আজকের রান সম্পন্ন। {netState[net].run!.final_failed} টি ওয়ালেট ক্লেম করা যায়নি।
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Failed keys box */}
              {net === activeNet && failedKeys.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between">
                      <button onClick={() => setShowFailedBox(!showFailedBox)} className="flex items-center gap-2 text-left">
                        ব্যর্থ ওয়ালেট ({failedKeys.length})
                        {showFailedBox ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <Button size="sm" onClick={copyAllFailed}>
                        <Copy className="w-4 h-4 mr-2" /> সব কী কপি করুন
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
                                <Button size="sm" variant="ghost" onClick={() => copy(k.private_key, "কী কপি হয়েছে")}>
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
              {net === activeNet && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between">
                      <span>সেভ করা {net.toUpperCase()} ওয়ালেট ({visibleWallets.length})</span>
                      {visibleWallets.length > 0 && (
                        <Button size="sm" variant="outline" onClick={deleteAllInActive}>সব মুছুন</Button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Textarea
                        rows={5}
                        placeholder={`এখানে প্রাইভেট কী পেস্ট করুন (প্রতি লাইনে একটি) — ${net.toUpperCase()} নেটওয়ার্কের অটো-ক্লেমের জন্য সেভ হবে`}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        className="font-mono text-xs"
                      />
                      <Button onClick={addKeys} disabled={adding} className="mt-2 w-full sm:w-auto">
                        {adding ? "যোগ হচ্ছে…" : `${net.toUpperCase()}-এ যোগ করুন`}
                      </Button>
                    </div>

                    {visibleWallets.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">এখনো কোনো {net.toUpperCase()} ওয়ালেট সেভ করা হয়নি।</p>
                    ) : (
                      <div className="space-y-1 max-h-80 overflow-y-auto">
                        {visibleWallets.map((w) => (
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
              )}

              {/* Per-wallet status table */}
              {net === activeNet && items.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle>প্রতিটি ওয়ালেটের অবস্থা</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 max-h-96 overflow-y-auto text-xs">
                      {items.map((it) => (
                        <div key={it.wallet_address} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/40">
                          <span className="font-mono flex-1">{shortAddr(it.wallet_address)}</span>
                          <Badge variant="outline" className={statusColor(it.phase1_status)}>ধাপ ১: {it.phase1_status}</Badge>
                          {it.gas_request_status && (
                            <Badge variant="outline" className="text-[10px]">গ্যাস: {it.gas_request_status}</Badge>
                          )}
                          {it.phase2_status && (
                            <Badge variant="outline" className={statusColor(it.phase2_status)}>ধাপ ২: {it.phase2_status}</Badge>
                          )}
                          <Badge variant="outline" className={statusColor(it.final_status)}>{it.final_status}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          ))}
        </Tabs>
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
