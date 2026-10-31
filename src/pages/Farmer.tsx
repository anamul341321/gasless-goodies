import { useEffect, useState } from "react";
import { Link, Navigate } from "@/lib/router-compat";
import {
  ArrowLeft, Loader2, Square, Sparkles, Send, ExternalLink, Search, Wallet as WalletIcon, Copy,
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
import CeloBatchSend from "@/components/CeloBatchSend";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

type SweepResult = {
  wallet: string;
  ok: boolean;
  tx?: string;
  amount?: string;
  error?: string;
};

export default function Farmer() {
  const { user, session, loading: authLoading } = useAuth();
  const { toast } = useToast();

  // ----- Sweeper state -----
  const [sweepKeys, setSweepKeys] = useState("");
  const [receiver, setReceiver] = useState("");
  const [sweeping, setSweeping] = useState(false);
  const [sweepResults, setSweepResults] = useState<SweepResult[] | null>(null);
  const [sweepSummary, setSweepSummary] = useState<{ total: number; success: number; failed: number; total_swept_celo: string } | null>(null);
  const [sweepProgress, setSweepProgress] = useState<{ done: number; total: number; success: number; failed: number } | null>(null);
  const [activeSweepJobId, setActiveSweepJobId] = useState<string | null>(null);

  // ----- ব্যালেন্স দেখুন state -----
  const [checkInput, setCheckInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResults, setCheckResults] = useState<{
    total_celo: number; ok: number; errors: number;
    results: { input: string; address?: string; balance?: string; error?: string }[];
  } | null>(null);

  const runBalanceCheck = async () => {
    const inputs = checkInput.split(/[\s,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (inputs.length === 0) {
      toast({ title: "অন্তত একটি ঠিকানা বা প্রাইভেট কী দিন", variant: "destructive" });
      return;
    }
    if (inputs.length > 1000) {
      toast({ title: "একবারে সর্বোচ্চ ১০০০টি দিন", variant: "destructive" });
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
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ inputs }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "দেখা যায়নি", description: json?.error || `HTTP ${res.status}`, variant: "destructive" });
      } else {
        setCheckResults(json);
      }
    } catch (e: any) {
      toast({ title: "সংযোগের সমস্যা", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  const copyAddresses = async () => {
    if (!checkResults) return;
    const addrs = checkResults.results.filter(r => r.address).map(r => r.address).join("\n");
    await navigator.clipboard.writeText(addrs);
    toast({ title: "ঠিকানা কপি হয়েছে" });
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
      toast({ title: "সঠিক প্রাইভেট কী দিন found", variant: "destructive" });
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(receiver.trim())) {
      toast({ title: "প্রাপকের ঠিকানা ভুল", variant: "destructive" });
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
        title: `সংগ্রহ শুরু হয়েছে`,
        description: `${json.total} wallets queued. Safe to close the browser.`,
      });
    } catch (e: any) {
      toast({ title: "সংযোগের সমস্যা", description: e?.message || String(e), variant: "destructive" });
      setSweeping(false);
    }
  };

  const stopSweep = async () => {
    if (!activeSweepJobId) return;
    if (!confirm("বন্ধ করুন the running sweep job? Pending wallets will not be swept.")) return;
    const { error } = await supabase
      .from("celo_sweep_jobs")
      .update({ status: "stopped", finished_at: new Date().toISOString() })
      .eq("id", activeSweepJobId);
    if (error) {
      toast({ title: "বন্ধ করুন failed", description: error.message, variant: "destructive" });
      return;
    }
    setSweeping(false);
    toast({ title: "সংগ্রহ বন্ধ হয়েছে" });
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
            <ArrowLeft className="size-4" /> ড্যাশবোর্ড
          </Link>
          <Badge variant="outline" className="gap-1">
            <Sparkles className="size-3" /> CELO সুবিধা
          </Badge>
        </div>

        <Tabs defaultValue="bulksend" className="space-y-4">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="gasloader">গ্যাস নিন</TabsTrigger>
            <TabsTrigger value="bulksend">CELO পাঠান</TabsTrigger>
            <TabsTrigger value="sweeper">CELO সংগ্রহ</TabsTrigger>
            <TabsTrigger value="check">ব্যালেন্স</TabsTrigger>
          </TabsList>

          {/* ============ GAS LOADER (embedded) ============ */}
          <TabsContent value="gasloader" className="space-y-4">
            <div className="-mx-4">
              <GasLoader />
            </div>
          </TabsContent>

          <TabsContent value="bulksend" className="space-y-4">
            <CeloBatchSend />
          </TabsContent>

          <TabsContent value="sweeper" className="space-y-4">
            <Card className="glass-card-elevated">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Send className="size-5" /> একসাথে CELO সংগ্রহ
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    প্রাপকের ঠিকানা
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
                    প্রতি লাইনে একটি প্রাইভেট কী
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
                    গ্যাসের খরচ বাদ দিয়ে CELO প্রাপকের কাছে যাবে।
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={runSweep} disabled={sweeping} className="flex-1">
                    {sweeping ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    {sweeping ? "সংগ্রহ হচ্ছে…" : "CELO সংগ্রহ করুন"}
                  </Button>
                  {sweeping && activeSweepJobId && (
                    <Button onClick={stopSweep} variant="destructive">
                      <Square className="size-4" /> বন্ধ করুন
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  
                </p>

                {sweepProgress && sweeping && (
                  <div className="mt-2 p-3 rounded bg-muted/40 border border-border">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-muted-foreground">বর্তমান অগ্রগতি</span>
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
                        <p className="text-[10px] text-muted-foreground uppercase">সম্পন্ন</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-destructive">{sweepProgress.failed}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">ব্যর্থ</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold">{sweepProgress.total - sweepProgress.done}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">বাকি</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {sweepSummary && (
              <Card className="glass-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">সংগ্রহের ফলাফল</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                    <div className="p-2 rounded bg-muted/40 border border-border">
                      <p className="text-lg font-bold text-success">{sweepSummary.success}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">সফল</p>
                    </div>
                    <div className="p-2 rounded bg-muted/40 border border-border">
                      <p className="text-lg font-bold text-destructive">{sweepSummary.failed}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">ব্যর্থ</p>
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
                            <Badge variant="destructive" className="text-[10px]">ব্যর্থ</Badge>
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
                    প্রতি লাইনে একটি ঠিকানা বা প্রাইভেট কী দিন (সর্বোচ্চ ১০০০টি)
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
                    ঠিকানা অথবা প্রাইভেট কী দিয়ে ব্যালেন্স দেখা যাবে।
                  </p>
                </div>
                <Button onClick={runBalanceCheck} disabled={checking} className="w-full">
                  {checking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  {checking ? "দেখা হচ্ছে…" : "ব্যালেন্স দেখুন"}
                </Button>

                {checkResults && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded bg-primary/10 border border-primary/20">
                        <p className="text-lg font-bold text-primary">
                          {checkResults.total_celo.toFixed(4)}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase">মোট CELO</p>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border border-border">
                        <p className="text-lg font-bold text-success">{checkResults.ok}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Wallets</p>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border border-border">
                        <p className="text-lg font-bold text-destructive">{checkResults.errors}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">ভুল</p>
                      </div>
                    </div>

                    <Button onClick={copyAddresses} variant="outline" size="sm" className="w-full">
                      <Copy className="size-3.5" /> সব কপি addresses
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
