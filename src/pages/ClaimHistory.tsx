import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Search,
  RefreshCw,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  Fuel,
  Sparkles,
  History as HistoryIcon,
} from "lucide-react";
import WalletDashboard from "@/components/WalletDashboard";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

type ClaimRow = {
  id: string;
  batch_name: string;
  total: number;
  done: number;
  failed: number;
  needs_gas: number;
  status: string;
  created_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
};

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(sec: number | null) {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

const ClaimHistory = () => {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [batches, setBatches] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshAt, setRefreshAt] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancel = false;
    const run = async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (debounced) qs.set("search", debounced);
        qs.set("limit", "100");
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/public-claim-history?${qs.toString()}`
        );
        const json = res.ok ? await res.json() : { rows: [] };
        if (!cancel) setBatches(json.rows || []);
      } catch (e) {
        console.warn("claim history fetch failed", e);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    run();
    return () => {
      cancel = true;
    };
  }, [debounced, refreshAt]);

  const totals = useMemo(() => {
    return batches.reduce(
      (acc, r) => {
        acc.batches += 1;
        acc.wallets += Number(r.total) || 0;
        acc.success += Number(r.done) || 0;
        acc.failed += Number(r.failed) || 0;
        acc.gas += Number(r.needs_gas) || 0;
        return acc;
      },
      { batches: 0, wallets: 0, success: 0, failed: 0, gas: 0 }
    );
  }, [batches]);

  return (
    <div className="aurora-bg min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <Link
            to="/claim"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Claim
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="w-3.5 h-3.5" /> Public Ledger
          </span>
        </header>

        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold heading-shimmer inline-flex items-center gap-2">
            <HistoryIcon className="w-7 h-7 text-primary" />
            Claim History
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm">
            Permanent public record of every G$ batch claim
          </p>
        </div>

        {/* Aggregate totals */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="glass-card card-glow">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Batches</div>
              <div className="text-2xl font-bold gradient-text">
                {totals.batches}
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card card-glow">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Wallets</div>
              <div className="text-2xl font-bold gradient-text">
                {totals.wallets}
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card card-glow">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Claimed</div>
              <div className="text-2xl font-bold text-primary">
                {totals.success}
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card card-glow">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Failed</div>
              <div className="text-2xl font-bold text-destructive">
                {totals.failed}
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card card-glow col-span-2 md:col-span-1">
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1 justify-center">
                <Fuel className="w-3 h-3" /> Auto Gas
              </div>
              <div className="text-2xl font-bold text-warning">
                {totals.gas}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Live wallet dashboard (G$ balance + KYC + next-claim countdown) */}
        <WalletDashboard />

        {/* Search */}
        <Card className="glass-card-elevated card-glow">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by batch name..."
                  className="h-11 pl-9"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11"
                onClick={() => setRefreshAt(Date.now())}
                aria-label="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Batch list */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold inline-flex items-center gap-2">
              <HistoryIcon className="w-4 h-4 text-primary" />
              All claim batches
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && batches.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-8">
                Loading…
              </p>
            )}
            {!loading && batches.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-8">
                No batches found.
              </p>
            )}
            {batches.map((b) => {
              const pct = b.total
                ? Math.round(((b.done + b.failed) / b.total) * 100)
                : 0;
              const isDone = b.status === "completed";
              return (
                <div
                  key={b.id}
                  className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-4 space-y-2 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-base truncate">
                        {b.batch_name}
                      </div>
                      <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                        <Calendar className="w-3 h-3" />
                        {formatDateTime(b.created_at)}
                      </div>
                    </div>
                    <Badge
                      variant={isDone ? "secondary" : "default"}
                      className={
                        isDone ? "" : "bg-primary text-primary-foreground"
                      }
                    >
                      {b.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-5 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-muted/30 p-2">
                      <div className="text-muted-foreground">Total</div>
                      <div className="font-semibold">{b.total}</div>
                    </div>
                    <div className="rounded-lg bg-primary/10 p-2">
                      <div className="text-muted-foreground inline-flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-primary" />
                      </div>
                      <div className="font-semibold text-primary">{b.done}</div>
                    </div>
                    <div className="rounded-lg bg-destructive/10 p-2">
                      <div className="text-muted-foreground inline-flex items-center justify-center gap-1">
                        <XCircle className="w-3 h-3 text-destructive" />
                      </div>
                      <div className="font-semibold text-destructive">
                        {b.failed}
                      </div>
                    </div>
                    <div className="rounded-lg bg-warning/10 p-2">
                      <div className="text-muted-foreground inline-flex items-center justify-center gap-1">
                        <Fuel className="w-3 h-3 text-warning" />
                      </div>
                      <div className="font-semibold text-warning">
                        {b.needs_gas}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-2">
                      <div className="text-muted-foreground inline-flex items-center justify-center gap-1">
                        <Clock className="w-3 h-3" />
                      </div>
                      <div className="font-semibold">
                        {formatDuration(b.duration_seconds)}
                      </div>
                    </div>
                  </div>

                  <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
                    <div
                      className="h-full premium-gradient transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground pb-4">
          Records are permanent and cannot be deleted.
        </p>
      </div>
    </div>
  );
};

export default ClaimHistory;
