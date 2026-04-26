import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Clock,
  Coins,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const STORAGE_KEY = "wallet_dashboard_addresses";

type WalletInfo = {
  address: string;
  whitelisted: boolean;
  balance: string;
  entitlement: string;
  canClaim: boolean;
  error?: string;
};

type DashboardData = {
  checked_at: string;
  next_claim_window_at: string;
  results: WalletInfo[];
};

function parseAddresses(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,;\n\r]+/)) {
    const t = part.trim();
    if (!t) continue;
    if (!/^0x[a-fA-F0-9]{40}$/.test(t)) continue;
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(t);
  }
  return out;
}

function useCountdown(targetIso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [targetIso]);
  if (!targetIso) return "";
  const diff = new Date(targetIso).getTime() - now;
  if (diff <= 0) return "available now";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

const WalletDashboard = () => {
  const { toast } = useToast();
  const [raw, setRaw] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) || ""
  );
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);

  const addresses = useMemo(() => parseAddresses(raw), [raw]);
  const countdown = useCountdown(data?.next_claim_window_at);

  const handleCheck = async () => {
    if (addresses.length === 0) {
      toast({ title: "Paste at least one valid address", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gd-wallet-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e: any) {
      toast({
        title: "Check failed",
        description: e?.message || "Could not load wallet info",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    if (!data) return null;
    let totalBalance = 0;
    let totalEntitlement = 0;
    let verified = 0;
    let ready = 0;
    for (const r of data.results) {
      totalBalance += Number(r.balance) || 0;
      totalEntitlement += Number(r.entitlement) || 0;
      if (r.whitelisted) verified += 1;
      if (r.canClaim) ready += 1;
    }
    return { totalBalance, totalEntitlement, verified, ready };
  }, [data]);

  return (
    <Card className="glass-card-elevated card-glow">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold inline-flex items-center gap-2">
          <LayoutDashboard className="w-4 h-4 text-primary" />
          Wallet dashboard
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Paste addresses (one per line) to see G$ balance, KYC status and next claim window.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={`0xabc...40hex\n0xdef...40hex\n...`}
          className="min-h-[100px] font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Addresses: {addresses.length}</Badge>
          <Button
            onClick={handleCheck}
            disabled={loading || addresses.length === 0}
            size="sm"
            className="ml-auto"
          >
            {loading ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Checking…</>
            ) : data ? (
              <><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh</>
            ) : (
              <><ShieldCheck className="w-3.5 h-3.5 mr-1" /> Check wallets</>
            )}
          </Button>
        </div>

        {data && totals && (
          <>
            {/* Aggregate */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-lg bg-primary/10 border border-primary/20 p-2.5 text-center">
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1 justify-center">
                  <Coins className="w-3 h-3 text-primary" /> Total G$
                </div>
                <div className="text-sm font-bold text-primary mt-0.5">
                  {totals.totalBalance.toFixed(2)}
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1 justify-center">
                  <CheckCircle2 className="w-3 h-3" /> Claimable now
                </div>
                <div className="text-sm font-bold mt-0.5">
                  {totals.totalEntitlement.toFixed(2)} G$
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1 justify-center">
                  <ShieldCheck className="w-3 h-3" /> Verified
                </div>
                <div className="text-sm font-bold mt-0.5">
                  {totals.verified} / {data.results.length}
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1 justify-center">
                  <Timer className="w-3 h-3" /> Ready
                </div>
                <div className="text-sm font-bold mt-0.5">{totals.ready}</div>
              </div>
            </div>

            {/* Next claim window */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <Clock className="w-4 h-4 text-primary" />
                <span className="text-muted-foreground">Next claim window opens in</span>
              </div>
              <span className="font-mono text-sm font-semibold text-primary tabular-nums">
                {countdown}
              </span>
            </div>

            {/* Per-wallet rows */}
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border/40 bg-card/60 divide-y divide-border/30">
              {data.results.map((w) => (
                <div
                  key={w.address}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-foreground truncate">
                      {w.address.slice(0, 8)}…{w.address.slice(-6)}
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      {Number(w.balance).toFixed(2)} G$
                      {Number(w.entitlement) > 0 && (
                        <span className="text-primary ml-2">
                          +{Number(w.entitlement).toFixed(2)} ready
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {w.whitelisted ? (
                      w.canClaim ? (
                        <Badge className="text-[10px] bg-primary text-primary-foreground hover:bg-primary">
                          <CheckCircle2 className="w-3 h-3 mr-0.5" /> ready
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          claimed today
                        </Badge>
                      )
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">
                        <ShieldAlert className="w-3 h-3 mr-0.5" /> unverified
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-muted-foreground text-center">
              Updated {new Date(data.checked_at).toLocaleTimeString()} · GoodDollar UBI cycle resets at 00:00 UTC daily.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default WalletDashboard;
