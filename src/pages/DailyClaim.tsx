import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, EyeOff, Trash2, Copy, RefreshCw, ChevronDown, ChevronUp, Clock, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Network = "celo" | "xdc";

type SavedWallet = {
  id: string; wallet_address: string; label: string | null; is_active: boolean;
  network: Network; group_id: string | null; created_at: string;
};

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
  id: string; run_date: string; network: Network; phase: string;
  total: number; success: number; failed_gas: number; failed_other: number; final_failed: number;
  started_at: string; gas_requests_done_at: string | null; finished_at: string | null;
};

type FailedKey = { wallet_address: string; private_key: string; status: string; error?: string };

type Group = {
  id: string; name: string; network: Network;
  start_hour_bd: number; start_minute_bd: number;
  retry_wait_minutes: number; enabled: boolean;
  wallet_count: number;
  run: Run | null; items: RunItem[]; failed_keys: FailedKey[];
};

function shortAddr(a: string) {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function phaseLabel(p: string | undefined) {
  switch (p) {
    case "claiming": return "ক্লেম হচ্ছে";
    case "gas_requesting": return "গ্যাস রিকোয়েস্ট হচ্ছে";
    case "waiting_30m": return "অপেক্ষা চলছে";
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

function fmt12(h: number, m: number) {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function countdownTo(hour: number, minute: number, now: number) {
  const n = new Date(now);
  const targetUtcMin = ((hour * 60 + minute) - 360 + 1440) % 1440;
  const nowSec = n.getUTCHours() * 3600 + n.getUTCMinutes() * 60 + n.getUTCSeconds();
  let diff = targetUtcMin * 60 - nowSec;
  if (diff <= 0) diff += 86400;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export default function DailyClaim() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [activeNet, setActiveNet] = useState<Network>("celo");
  const [wallets, setWallets] = useState<SavedWallet[]>([]);
  const [walletCounts, setWalletCounts] = useState<Record<Network, number>>({ celo: 0, xdc: 0 });
  const [groups, setGroups] = useState<Group[]>([]);
  const [tickNow, setTickNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTickNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const [pasteText, setPasteText] = useState("");
  const [pasteGroupId, setPasteGroupId] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [shownKeys, setShownKeys] = useState<Record<string, boolean>>({});
  const [openGroupRuns, setOpenGroupRuns] = useState<Record<string, boolean>>({});
  const [openGroupFailed, setOpenGroupFailed] = useState<Record<string, boolean>>({});
  const [openGroupHistory, setOpenGroupHistory] = useState<Record<string, boolean>>({});
  const [historyByGroup, setHistoryByGroup] = useState<Record<string, any[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [openHistoryRun, setOpenHistoryRun] = useState<Record<string, boolean>>({});
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Group>>({});
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: "", hour: 0, minute: 0, waitMin: 30 });
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/auth");
  }, [user, loading, navigate]);

  async function fetchAll() {
    if (!user) return;
    setRefreshing(true);
    try {
      const [walletsRes, statusRes] = await Promise.all([
        supabase.functions.invoke("daily-claim-wallets"),
        supabase.functions.invoke("daily-claim-status"),
      ]);
      if (walletsRes.data?.wallets) setWallets(walletsRes.data.wallets);
      if (statusRes.data) {
        if (statusRes.data.wallet_counts) setWalletCounts(statusRes.data.wallet_counts);
        if (statusRes.data.groups) setGroups(statusRes.data.groups);
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    fetchAll();
    pollRef.current = window.setInterval(fetchAll, 8000) as unknown as number;
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const netGroups = useMemo(() => groups.filter((g) => g.network === activeNet), [groups, activeNet]);
  const visibleWallets = useMemo(() => wallets.filter((w) => (w.network || "celo") === activeNet), [wallets, activeNet]);

  // Default selected group for the paste box
  useEffect(() => {
    if (!pasteGroupId && netGroups.length > 0) setPasteGroupId(netGroups[0].id);
    if (pasteGroupId && !netGroups.find((g) => g.id === pasteGroupId)) {
      setPasteGroupId(netGroups[0]?.id || "");
    }
  }, [netGroups, pasteGroupId]);

  async function createGroup() {
    if (!newGroup.name.trim()) {
      toast({ title: "গ্রুপের নাম দিন" });
      return;
    }
    const { data, error } = await supabase.functions.invoke("daily-claim-wallets?action=create_group", {
      body: {
        network: activeNet,
        name: newGroup.name.trim(),
        start_hour_bd: newGroup.hour,
        start_minute_bd: newGroup.minute,
        retry_wait_minutes: newGroup.waitMin,
        enabled: true,
      },
    });
    if (error || (data as any)?.error) {
      toast({ title: "তৈরি করা যায়নি", description: (data as any)?.error || error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "গ্রুপ তৈরি হয়েছে" });
    setShowNewGroup(false);
    setNewGroup({ name: "", hour: 0, minute: 0, waitMin: 30 });
    fetchAll();
  }

  async function saveGroup(g: Group) {
    const patch = {
      id: g.id,
      name: editDraft.name ?? g.name,
      start_hour_bd: editDraft.start_hour_bd ?? g.start_hour_bd,
      start_minute_bd: editDraft.start_minute_bd ?? g.start_minute_bd,
      retry_wait_minutes: editDraft.retry_wait_minutes ?? g.retry_wait_minutes,
      enabled: editDraft.enabled ?? g.enabled,
    };
    const { data, error } = await supabase.functions.invoke("daily-claim-wallets?action=update_group", { body: patch });
    if (error || (data as any)?.error) {
      toast({ title: "সেভ ব্যর্থ", description: (data as any)?.error || error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "সেভ হয়েছে" });
    setEditingGroup(null);
    setEditDraft({});
    fetchAll();
  }

  async function toggleGroupEnabled(g: Group, enabled: boolean) {
    await supabase.functions.invoke("daily-claim-wallets?action=update_group", {
      body: { id: g.id, enabled },
    });
    fetchAll();
  }

  async function deleteGroup(g: Group) {
    if (!confirm(`"${g.name}" গ্রুপ মুছে ফেলবেন? ওয়ালেটগুলো গ্রুপ থেকে আলাদা হয়ে যাবে (মুছবে না)।`)) return;
    await supabase.functions.invoke("daily-claim-wallets?action=delete_group", { body: { id: g.id } });
    toast({ title: "গ্রুপ মুছে ফেলা হয়েছে" });
    fetchAll();
  }

  async function addKeys() {
    const lines = pasteText.split(/\s+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { toast({ title: "অন্তত একটি কী পেস্ট করুন" }); return; }
    if (netGroups.length === 0) { toast({ title: "আগে একটি গ্রুপ তৈরি করুন" }); return; }
    setAdding(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-claim-wallets?action=add", {
        body: { private_keys: lines, network: activeNet, group_id: pasteGroupId || netGroups[0].id },
      });
      if (error) throw error;
      const groupName = netGroups.find((g) => g.id === pasteGroupId)?.name || netGroups[0].name;
      toast({
        title: `${data?.added ?? 0} টি ওয়ালেট "${groupName}" গ্রুপে যোগ হয়েছে`,
        description: data?.invalid ? `${data.invalid} টি অবৈধ কী বাদ` : undefined,
      });
      setPasteText("");
      fetchAll();
    } catch (e: any) {
      toast({ title: "ব্যর্থ", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function assignWalletGroup(walletId: string, groupId: string | null) {
    await supabase.functions.invoke("daily-claim-wallets?action=assign_group", {
      body: { wallet_ids: [walletId], group_id: groupId },
    });
    fetchAll();
  }

  async function removeWallet(id: string) {
    await supabase.functions.invoke("daily-claim-wallets?action=delete", { body: { id } });
    fetchAll();
  }

  async function toggleActive(id: string, is_active: boolean) {
    await supabase.functions.invoke("daily-claim-wallets?action=toggle", { body: { id, is_active } });
    fetchAll();
  }

  function copy(text: string, label = "কপি হয়েছে") {
    navigator.clipboard.writeText(text).then(() => toast({ title: label }));
  }

  async function loadHistory(groupId: string) {
    setHistoryLoading((s) => ({ ...s, [groupId]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("daily-claim-history", {
        body: { group_id: groupId, limit: 30 },
      });
      if (error || (data as any)?.error) {
        toast({ title: "ইতিহাস লোড ব্যর্থ", description: (data as any)?.error || error?.message, variant: "destructive" });
        return;
      }
      setHistoryByGroup((s) => ({ ...s, [groupId]: (data as any)?.runs || [] }));
    } finally {
      setHistoryLoading((s) => ({ ...s, [groupId]: false }));
    }
  }

  function toggleHistory(groupId: string) {
    const willOpen = !openGroupHistory[groupId];
    setOpenGroupHistory((s) => ({ ...s, [groupId]: willOpen }));
    if (willOpen && !historyByGroup[groupId]) loadHistory(groupId);
  }

  function copyFailed(g: Group) {
    if (g.failed_keys.length === 0) return;
    copy(g.failed_keys.map((k) => k.private_key).join("\n"), `${g.failed_keys.length} টি ব্যর্থ কী কপি`);
  }

  function waitRemainingFor(g: Group) {
    const run = g.run;
    if (!run || run.phase !== "waiting_30m" || !run.gas_requests_done_at) return null;
    const endsAt = new Date(run.gas_requests_done_at).getTime() + g.retry_wait_minutes * 60_000;
    const left = Math.max(0, endsAt - tickNow);
    const totalSec = Math.ceil(left / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

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
              যত খুশি গ্রুপ — প্রতিটি গ্রুপের আলাদা সময় ও আলাদা ওয়ালেট সেট
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} /> রিফ্রেশ
          </Button>
        </header>

        <Tabs value={activeNet} onValueChange={(v) => setActiveNet(v as Network)}>
          <TabsList className="grid grid-cols-2 w-full max-w-xs">
            <TabsTrigger value="celo">Celo ({walletCounts.celo})</TabsTrigger>
            <TabsTrigger value="xdc">XDC ({walletCounts.xdc})</TabsTrigger>
          </TabsList>

          {(["celo", "xdc"] as Network[]).map((net) => (
            <TabsContent key={net} value={net} className="space-y-6 mt-4">
              {/* Groups list */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2"><Clock className="w-4 h-4" /> ক্লেম গ্রুপ — {net.toUpperCase()}</span>
                    {net === activeNet && (
                      <Button size="sm" onClick={() => setShowNewGroup((v) => !v)}>
                        <Plus className="w-4 h-4 mr-1" /> নতুন গ্রুপ
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    প্রতিটি গ্রুপের আলাদা শুরুর সময়, আলাদা অপেক্ষা সময় ও আলাদা ওয়ালেট সেট। যেমন: ৫০০ ওয়ালেট রাত ১২টায়, আরেক গ্রুপ ৩০০ ওয়ালেট রাত ৩টায়।
                  </p>

                  {net === activeNet && showNewGroup && (
                    <div className="rounded-md border border-border p-3 space-y-3 bg-muted/30">
                      <div className="flex gap-2 flex-wrap">
                        <div className="flex flex-col">
                          <label className="text-xs text-muted-foreground mb-1">গ্রুপের নাম</label>
                          <Input value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} placeholder="যেমন: ব্যাচ A" className="w-48" />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-muted-foreground mb-1">শুরুর সময় (BD)</label>
                          <Input
                            type="time" step={60}
                            value={`${String(newGroup.hour).padStart(2,"0")}:${String(newGroup.minute).padStart(2,"0")}`}
                            onChange={(e) => {
                              const [h, m] = (e.target.value || "00:00").split(":").map((x) => Number(x) || 0);
                              setNewGroup({ ...newGroup, hour: h, minute: m });
                            }}
                            className="w-32"
                          />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-xs text-muted-foreground mb-1">অপেক্ষা (মিনিট)</label>
                          <Input type="number" min={1} max={240} value={newGroup.waitMin}
                            onChange={(e) => setNewGroup({ ...newGroup, waitMin: Math.max(1, Math.min(240, Number(e.target.value) || 1)) })}
                            className="w-24"
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <Button size="sm" onClick={createGroup}>তৈরি করুন</Button>
                          <Button size="sm" variant="ghost" onClick={() => setShowNewGroup(false)}>বাতিল</Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {groups.filter((g) => g.network === net).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">এখনো কোনো {net.toUpperCase()} গ্রুপ নেই। উপরের "নতুন গ্রুপ" বোতাম চাপুন।</p>
                  ) : (
                    <div className="space-y-3">
                      {groups.filter((g) => g.network === net).map((g) => {
                        const isEditing = editingGroup === g.id;
                        const hr = isEditing ? (editDraft.start_hour_bd ?? g.start_hour_bd) : g.start_hour_bd;
                        const mn = isEditing ? (editDraft.start_minute_bd ?? g.start_minute_bd) : g.start_minute_bd;
                        const wt = isEditing ? (editDraft.retry_wait_minutes ?? g.retry_wait_minutes) : g.retry_wait_minutes;
                        const nm = isEditing ? (editDraft.name ?? g.name) : g.name;
                        const wr = waitRemainingFor(g);
                        return (
                          <div key={g.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {isEditing ? (
                                  <Input value={nm} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className="h-8 max-w-xs" />
                                ) : (
                                  <span className="font-semibold truncate">{nm}</span>
                                )}
                                <Badge variant="outline">{g.wallet_count} ওয়ালেট</Badge>
                                {g.run && <Badge variant="outline">{phaseLabel(g.run.phase)}</Badge>}
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch checked={isEditing ? !!editDraft.enabled : g.enabled} onCheckedChange={(v) => {
                                  if (isEditing) setEditDraft({ ...editDraft, enabled: v });
                                  else toggleGroupEnabled(g, v);
                                }} />
                                <span className="text-xs text-muted-foreground">{(isEditing ? editDraft.enabled : g.enabled) ? "চালু" : "বন্ধ"}</span>
                              </div>
                            </div>

                            <div className="flex items-end gap-2 flex-wrap text-sm">
                              {isEditing ? (
                                <>
                                  <div className="flex flex-col">
                                    <label className="text-xs text-muted-foreground mb-1">সময় (BD)</label>
                                    <Input type="time" step={60}
                                      value={`${String(hr).padStart(2,"0")}:${String(mn).padStart(2,"0")}`}
                                      onChange={(e) => {
                                        const [h, m] = (e.target.value || "00:00").split(":").map((x) => Number(x) || 0);
                                        setEditDraft({ ...editDraft, start_hour_bd: h, start_minute_bd: m });
                                      }}
                                      className="w-32 h-8"
                                    />
                                  </div>
                                  <div className="flex flex-col">
                                    <label className="text-xs text-muted-foreground mb-1">অপেক্ষা (মিনিট)</label>
                                    <Input type="number" min={1} max={240} value={wt}
                                      onChange={(e) => setEditDraft({ ...editDraft, retry_wait_minutes: Math.max(1, Math.min(240, Number(e.target.value) || 1)) })}
                                      className="w-24 h-8"
                                    />
                                  </div>
                                  <Button size="sm" onClick={() => saveGroup(g)}>সেভ</Button>
                                  <Button size="sm" variant="ghost" onClick={() => { setEditingGroup(null); setEditDraft({}); }}>বাতিল</Button>
                                </>
                              ) : (
                                <>
                                  <span className="text-muted-foreground">শুরু: <b className="text-foreground">{fmt12(hr, mn)} BD</b></span>
                                  <span className="text-muted-foreground">অপেক্ষা: <b className="text-foreground">{wt} মিনিট</b></span>
                                  <span className="ml-auto text-xs font-mono text-emerald-400">পরবর্তী: {countdownTo(hr, mn, tickNow)}</span>
                                  <Button size="sm" variant="outline" onClick={() => { setEditingGroup(g.id); setEditDraft({ enabled: g.enabled }); }}>এডিট</Button>
                                  <Button size="sm" variant="ghost" onClick={() => deleteGroup(g)}>
                                    <Trash2 className="w-4 h-4 text-rose-400" />
                                  </Button>
                                </>
                              )}
                            </div>

                            {/* Today's run summary */}
                            {g.run && (
                              <div className="pt-2 border-t border-border space-y-2">
                                <div className="grid grid-cols-5 gap-2 text-center">
                                  <Stat label="মোট" value={g.run.total} />
                                  <Stat label="সফল" value={g.run.success} tone="text-emerald-400" />
                                  <Stat label="গ্যাস" value={g.run.failed_gas} tone="text-amber-400" />
                                  <Stat label="অন্য" value={g.run.failed_other} tone="text-rose-400" />
                                  <Stat label="ফাইনাল" value={g.run.final_failed} tone="text-rose-400" />
                                </div>
                                {g.run.phase === "waiting_30m" && wr && (
                                  <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-center">
                                    <div className="text-xs uppercase tracking-wider text-muted-foreground">গ্যাস আসার অপেক্ষা</div>
                                    <div className="font-mono font-black text-amber-400 text-3xl tabular-nums">{wr}</div>
                                  </div>
                                )}
                                {g.failed_keys.length > 0 && (
                                  <div className="rounded-md border border-border">
                                    <button className="w-full px-3 py-2 flex items-center justify-between text-sm"
                                      onClick={() => setOpenGroupFailed((s) => ({ ...s, [g.id]: !s[g.id] }))}>
                                      <span>ব্যর্থ কী ({g.failed_keys.length})</span>
                                      <div className="flex items-center gap-2">
                                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); copyFailed(g); }}>
                                          <Copy className="w-4 h-4" />
                                        </Button>
                                        {openGroupFailed[g.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                      </div>
                                    </button>
                                    {openGroupFailed[g.id] && (
                                      <div className="px-3 pb-3 space-y-1 max-h-72 overflow-y-auto">
                                        {g.failed_keys.map((k) => (
                                          <div key={k.wallet_address} className="p-2 rounded-md bg-muted/40 border border-border text-xs">
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="font-mono">{shortAddr(k.wallet_address)}</span>
                                              <Badge variant="outline" className={statusColor(k.status)}>{k.status}</Badge>
                                              <div className="flex gap-1 ml-auto">
                                                <Button size="sm" variant="ghost" onClick={() => setShownKeys((s) => ({ ...s, [k.wallet_address]: !s[k.wallet_address] }))}>
                                                  {shownKeys[k.wallet_address] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </Button>
                                                <Button size="sm" variant="ghost" onClick={() => copy(k.private_key)}>
                                                  <Copy className="w-4 h-4" />
                                                </Button>
                                              </div>
                                            </div>
                                            {shownKeys[k.wallet_address] && (
                                              <code className="block mt-1 break-all font-mono text-muted-foreground">{k.private_key}</code>
                                            )}
                                            {k.error && <p className="text-rose-400 mt-1">{k.error}</p>}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <button className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1"
                                  onClick={() => setOpenGroupRuns((s) => ({ ...s, [g.id]: !s[g.id] }))}>
                                  {openGroupRuns[g.id] ? <>লুকান <ChevronUp className="w-3 h-3" /></> : <>প্রতিটি ওয়ালেটের অবস্থা <ChevronDown className="w-3 h-3" /></>}
                                </button>
                                {openGroupRuns[g.id] && (
                                  <div className="space-y-1 max-h-72 overflow-y-auto text-xs">
                                    {g.items.map((it) => (
                                      <div key={it.wallet_address} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/40">
                                        <span className="font-mono flex-1">{shortAddr(it.wallet_address)}</span>
                                        <Badge variant="outline" className={statusColor(it.final_status)}>{it.final_status}</Badge>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* History */}
                            <div className="pt-2 border-t border-border">
                              <button className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-1"
                                onClick={() => toggleHistory(g.id)}>
                                {openGroupHistory[g.id] ? <>ইতিহাস লুকান <ChevronUp className="w-3 h-3" /></> : <>ইতিহাস দেখুন <ChevronDown className="w-3 h-3" /></>}
                              </button>
                              {openGroupHistory[g.id] && (
                                <div className="mt-2 space-y-2">
                                  {historyLoading[g.id] && (
                                    <p className="text-xs text-muted-foreground text-center py-2">লোড হচ্ছে…</p>
                                  )}
                                  {!historyLoading[g.id] && (historyByGroup[g.id]?.length ?? 0) === 0 && (
                                    <p className="text-xs text-muted-foreground text-center py-2">কোনো পুরনো রান নেই।</p>
                                  )}
                                  {(historyByGroup[g.id] || []).map((r: any) => {
                                    const rk = `${g.id}:${r.id}`;
                                    const isOpen = !!openHistoryRun[rk];
                                    return (
                                      <div key={r.id} className="rounded-md border border-border bg-muted/20">
                                        <button className="w-full p-2 flex items-center justify-between gap-2 text-xs"
                                          onClick={() => setOpenHistoryRun((s) => ({ ...s, [rk]: !s[rk] }))}>
                                          <span className="font-mono">{r.run_date}</span>
                                          <span className="flex items-center gap-1">
                                            <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">✓{r.success}</Badge>
                                            <Badge variant="outline" className="text-amber-400 border-amber-500/30">⛽{r.failed_gas}</Badge>
                                            <Badge variant="outline" className="text-rose-400 border-rose-500/30">✗{(r.final_failed || 0) + (r.failed_other || 0)}</Badge>
                                            <Badge variant="outline">{r.total}</Badge>
                                          </span>
                                          {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                        </button>
                                        {isOpen && (
                                          <div className="px-2 pb-2 space-y-2">
                                            <div className="text-[11px] text-muted-foreground">
                                              ফেজ: {phaseLabel(r.phase)} · শুরু: {new Date(r.started_at).toLocaleString("en-GB", { hour12: false })}
                                              {r.finished_at && <> · শেষ: {new Date(r.finished_at).toLocaleTimeString()}</>}
                                            </div>
                                            {r.gas_summary && r.gas_summary.total > 0 && (
                                              <div className="rounded-md border border-border bg-background/40 p-2 text-[11px] space-y-1">
                                                <div className="flex items-center justify-between">
                                                  <span className="font-medium">Gas requests</span>
                                                  <span className="flex items-center gap-1">
                                                    <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">✓{r.gas_summary.done}</Badge>
                                                    {r.gas_summary.requested > 0 && <Badge variant="outline" className="text-sky-400 border-sky-500/30">…{r.gas_summary.requested}</Badge>}
                                                    {r.gas_summary.error > 0 && <Badge variant="outline" className="text-rose-400 border-rose-500/30">✗{r.gas_summary.error}</Badge>}
                                                    <Badge variant="outline">{r.gas_summary.total}</Badge>
                                                  </span>
                                                </div>
                                                {(r.gas_jobs || []).map((j: any) => (
                                                  <div key={j.id} className="flex items-center justify-between gap-2 text-muted-foreground">
                                                    <span className="font-mono truncate">{j.batch_name}</span>
                                                    <span className="flex items-center gap-1">
                                                      <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">✓{j.done}</Badge>
                                                      {j.failed > 0 && <Badge variant="outline" className="text-rose-400 border-rose-500/30">✗{j.failed}</Badge>}
                                                      <Badge variant="outline">{j.total}</Badge>
                                                      <Badge variant="outline" className="text-[10px]">{j.status}</Badge>
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                            {r.failed_keys?.length > 0 && (
                                              <div className="rounded-md border border-border bg-background/40">
                                                <div className="px-2 py-1 flex items-center justify-between text-xs">
                                                  <span>ব্যর্থ কী ({r.failed_keys.length})</span>
                                                  <Button size="sm" variant="ghost" onClick={() => copy(r.failed_keys.map((k: any) => k.private_key).join("\n"), `${r.failed_keys.length} টি কপি`)}>
                                                    <Copy className="w-3 h-3" />
                                                  </Button>
                                                </div>
                                                <div className="px-2 pb-2 space-y-1 max-h-48 overflow-y-auto">
                                                  {r.failed_keys.map((k: any) => {
                                                    const sk = `h:${r.id}:${k.wallet_address}`;
                                                    return (
                                                      <div key={k.wallet_address} className="p-1.5 rounded bg-muted/40 border border-border text-[11px]">
                                                        <div className="flex items-center gap-2">
                                                          <span className="font-mono flex-1">{shortAddr(k.wallet_address)}</span>
                                                          <Badge variant="outline" className={statusColor(k.status)}>{k.status}</Badge>
                                                          <Button size="sm" variant="ghost" onClick={() => setShownKeys((s) => ({ ...s, [sk]: !s[sk] }))}>
                                                            {shownKeys[sk] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                                          </Button>
                                                          <Button size="sm" variant="ghost" onClick={() => copy(k.private_key)}>
                                                            <Copy className="w-3 h-3" />
                                                          </Button>
                                                        </div>
                                                        {shownKeys[sk] && (
                                                          <code className="block mt-1 break-all font-mono text-muted-foreground">{k.private_key}</code>
                                                        )}
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              </div>
                                            )}
                                            {r.items?.length > 0 && (
                                              <div className="space-y-0.5 max-h-48 overflow-y-auto text-[11px]">
                                                {r.items.map((it: any) => (
                                                  <div key={it.wallet_address} className="flex items-center gap-2 p-1 rounded hover:bg-muted/40">
                                                    <span className="font-mono flex-1">{shortAddr(it.wallet_address)}</span>
                                                    <Badge variant="outline" className={statusColor(it.final_status)}>{it.final_status}</Badge>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Saved wallets — add + list with group selector */}
              {net === activeNet && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle>সেভ করা {net.toUpperCase()} ওয়ালেট ({visibleWallets.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Textarea
                        rows={5}
                        placeholder={`প্রতি লাইনে একটি প্রাইভেট কী পেস্ট করুন — ${net.toUpperCase()} নেটওয়ার্কে যোগ হবে`}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        className="font-mono text-xs"
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-xs text-muted-foreground">কোন গ্রুপে যোগ হবে:</label>
                        <Select value={pasteGroupId} onValueChange={setPasteGroupId} disabled={netGroups.length === 0}>
                          <SelectTrigger className="w-56 h-9"><SelectValue placeholder="গ্রুপ বেছে নিন" /></SelectTrigger>
                          <SelectContent>
                            {netGroups.map((g) => (
                              <SelectItem key={g.id} value={g.id}>{g.name} · {fmt12(g.start_hour_bd, g.start_minute_bd)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button onClick={addKeys} disabled={adding || netGroups.length === 0}>
                          {adding ? "যোগ হচ্ছে…" : `যোগ করুন`}
                        </Button>
                      </div>
                      {netGroups.length === 0 && (
                        <p className="text-xs text-amber-400">কী যোগ করার আগে অন্তত একটি গ্রুপ তৈরি করুন।</p>
                      )}
                    </div>

                    {visibleWallets.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">এখনো কোনো ওয়ালেট নেই।</p>
                    ) : (
                      <div className="space-y-1 max-h-96 overflow-y-auto">
                        {visibleWallets.map((w) => (
                          <div key={w.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/40">
                            <span className="font-mono text-xs flex-1 min-w-0 truncate">{shortAddr(w.wallet_address)}</span>
                            <Select value={w.group_id || "__none__"} onValueChange={(v) => assignWalletGroup(w.id, v === "__none__" ? null : v)}>
                              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="গ্রুপ" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— গ্রুপ নেই —</SelectItem>
                                {netGroups.map((g) => (
                                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
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
      <div className={`text-lg font-bold ${tone || ""}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
