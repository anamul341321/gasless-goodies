import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Crown, Wallet, Plus, Upload, Loader2, CheckCircle2, Clock, XCircle,
  Calendar, Fuel, Sparkles, TrendingUp, Receipt, Shield, Zap, ChevronRight, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useWallet } from "@/hooks/useWallet";

const EDGE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

type Membership = {
  id: string;
  package_id: string;
  package_name: string;
  price_usdt: number;
  duration_days: number;
  wallet_slots: number;
  status: string;
  starts_at: string | null;
  expires_at: string | null;
  locked_count: number;
  created_at: string;
};

type Payment = {
  id: string;
  package_id: string;
  tx_hash: string;
  amount_usdt: number | null;
  expected_amount: number;
  status: string;
  admin_note: string | null;
  created_at: string;
};

export default function VipDashboard() {
  const wallet = useWallet();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [openMembership, setOpenMembership] = useState<Membership | null>(null);
  const [walletInput, setWalletInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!wallet.address) return;
    setLoading(true);
    try {
      const r = await fetch(`${EDGE}/vip-membership-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: wallet.address }),
      });
      const d = await r.json();
      setMemberships(d.memberships || []);
      setPayments(d.payments || []);
    } catch {
      toast.error("Failed to load");
    }
    setLoading(false);
  }, [wallet.address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const active = memberships.filter(
      (m) => m.status === "active" && (!m.expires_at || new Date(m.expires_at) > new Date())
    );
    const totalSlots = active.reduce((s, m) => s + m.wallet_slots, 0);
    const usedSlots = active.reduce((s, m) => s + m.locked_count, 0);
    return {
      activeCount: active.length,
      totalSlots,
      usedSlots,
      slotsLeft: totalSlots - usedSlots,
    };
  }, [memberships]);

  const handleFile = async (file: File) => {
    const text = await file.text();
    setWalletInput((prev) => (prev ? prev + "\n" + text : text));
    toast.success(`Loaded ${file.name}`);
  };

  const submitWallets = async () => {
    if (!wallet.address || !openMembership) return;
    const wallets = walletInput
      .split(/[\s,;\n]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (wallets.length === 0) {
      toast.error("Paste or upload wallet addresses");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${EDGE}/vip-add-locked-wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_wallet: wallet.address,
          membership_id: openMembership.id,
          wallets,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error || "Failed");
      } else {
        toast.success(
          `Added ${d.added} wallets (${d.total_locked}/${d.slots || 350} used, ${d.slots_remaining} remaining)`,
          { duration: 5000 },
        );
        setWalletInput("");
        setOpenMembership(null);
        refresh();
      }
    } catch {
      toast.error("Network error");
    }
    setSubmitting(false);
  };

  if (!wallet.address) {
    return (
      <div className="aurora-bg min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
        <Card className="max-w-md w-full p-10 text-center glass-card-elevated relative z-10">
          <div className="h-20 w-20 rounded-3xl premium-gradient mx-auto mb-6 flex items-center justify-center premium-glow">
            <Crown className="h-10 w-10 text-primary-foreground" />
          </div>
          <h2 className="text-2xl font-extrabold mb-2 gradient-text">Buy IP Dashboard</h2>
          <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
            Connect the wallet that owns your Buy IP membership to access locked wallets and gas loading.
          </p>
          <Button
            size="lg"
            className="w-full h-12 text-base font-bold rounded-2xl premium-gradient text-primary-foreground premium-shadow"
            onClick={() =>
              wallet.connect().catch((e) => toast.error(e?.message || "Connect failed"))
            }
            disabled={wallet.connecting}
          >
            <Wallet className="h-5 w-5 mr-2" />
            {wallet.connecting ? "Connecting…" : "Connect Wallet"}
          </Button>
          <Link to="/vip" className="block mt-5 text-sm text-primary font-semibold hover:underline">
            Browse Buy IP packages →
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="aurora-bg min-h-screen bg-background relative overflow-hidden">
      {/* Header */}
      <header className="border-b border-border/40 backdrop-blur-xl sticky top-0 z-20 bg-background/80">
        <div className="max-w-5xl mx-auto px-4 py-3.5 flex items-center gap-3">
          <Link
            to="/vip"
            className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Packages
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-xs px-3 py-1.5 rounded-xl bg-muted/60 border border-border/40 hidden sm:inline">
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </span>
            <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => wallet.disconnect()}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6 relative z-10">
        {/* Hero Card */}
        <div className="glass-card-elevated p-6 sm:p-8 relative overflow-hidden">
          <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-accent/15 blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="h-16 w-16 rounded-2xl premium-gradient flex items-center justify-center premium-glow shrink-0">
              <Crown className="h-8 w-8 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 mb-2">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Buy IP Dashboard</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">
                <span className="gradient-text">Welcome back</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage your memberships, locked wallets and run gas loads.
              </p>
            </div>
            <Link to="/vip/load" className="shrink-0">
              <Button
                size="lg"
                className="w-full sm:w-auto h-12 px-6 rounded-2xl premium-gradient text-primary-foreground font-bold premium-shadow text-base"
              >
                <Fuel className="h-5 w-5 mr-2" /> Load Gas
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            icon={Crown}
            label="Active Plans"
            value={stats.activeCount.toString()}
            tint="primary"
          />
          <StatCard
            icon={Wallet}
            label="Locked Wallets"
            value={stats.usedSlots.toString()}
            sub={`of ${stats.totalSlots}`}
            tint="accent"
          />
          <StatCard
            icon={Zap}
            label="Slots Available"
            value={stats.slotsLeft.toString()}
            tint="success"
          />
          <StatCard
            icon={Receipt}
            label="Payments"
            value={payments.length.toString()}
            tint="warning"
          />
        </div>

        {/* Memberships section */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-base font-bold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> My Memberships
            </h2>
            <Link
              to="/vip"
              className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1"
            >
              Browse <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          {loading && (
            <Card className="p-10 text-center glass-card">
              <Loader2 className="h-6 w-6 animate-spin inline text-primary" />
              <p className="text-sm text-muted-foreground mt-2">Loading memberships…</p>
            </Card>
          )}

          {!loading && memberships.length === 0 && (
            <Card className="glass-card p-10 text-center">
              <div className="h-16 w-16 rounded-2xl premium-gradient-subtle border border-primary/20 mx-auto mb-4 flex items-center justify-center">
                <Crown className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-1">No memberships yet</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
                Get a Buy IP package to lock wallets and unlock unlimited Celo gas loads.
              </p>
              <Link to="/vip">
                <Button
                  size="lg"
                  className="h-12 px-6 rounded-2xl premium-gradient text-primary-foreground font-bold premium-shadow"
                >
                  <Crown className="h-5 w-5 mr-2" /> Browse Packages
                </Button>
              </Link>
            </Card>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            {memberships.map((m) => {
              const expired =
                m.status !== "active" ||
                (m.expires_at && new Date(m.expires_at) < new Date());
              const slotsLeft = m.wallet_slots - m.locked_count;
              const pct = (m.locked_count / m.wallet_slots) * 100;
              const daysLeft = m.expires_at
                ? Math.max(0, Math.ceil((new Date(m.expires_at).getTime() - Date.now()) / 86400000))
                : 0;
              return (
                <Card
                  key={m.id}
                  className={`glass-card p-5 relative overflow-hidden transition-all hover:premium-shadow ${
                    expired ? "opacity-70" : ""
                  }`}
                >
                  {!expired && (
                    <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
                  )}
                  <div className="relative">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-11 w-11 rounded-2xl premium-gradient-subtle border border-primary/20 flex items-center justify-center shrink-0">
                          <Crown className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-base leading-tight truncate">{m.package_name}</h3>
                          <p className="text-xs text-muted-foreground font-medium">
                            ${m.price_usdt} · {m.duration_days} days
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full shrink-0 ${
                          m.status === "active" && !expired
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : m.status === "pending_payment"
                              ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {expired && m.status === "active" ? "expired" : m.status}
                      </span>
                    </div>

                    {m.expires_at && (
                      <div className="flex items-center gap-1.5 text-xs mb-4 px-3 py-2 rounded-xl bg-muted/40">
                        <Calendar className="h-3.5 w-3.5 text-primary" />
                        <span className="font-semibold text-foreground">
                          {expired ? "Expired" : `${daysLeft} days left`}
                        </span>
                        <span className="ml-auto font-mono text-muted-foreground">
                          {new Date(m.expires_at).toLocaleDateString()}
                        </span>
                      </div>
                    )}

                    <div className="mb-4">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-muted-foreground font-medium">Locked wallets</span>
                        <span className="font-bold text-foreground">
                          {m.locked_count}/{m.wallet_slots}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full premium-gradient transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {!expired && m.status === "active" ? (
                      <Button
                        size="lg"
                        className={`w-full h-12 rounded-2xl font-bold text-sm ${
                          slotsLeft > 0
                            ? "premium-gradient text-primary-foreground premium-shadow"
                            : ""
                        }`}
                        variant={slotsLeft > 0 ? "default" : "outline"}
                        onClick={() => setOpenMembership(m)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {slotsLeft > 0
                          ? `Add Wallets · ${slotsLeft} slots`
                          : "View Locked Wallets"}
                      </Button>
                    ) : (
                      <Link to="/vip">
                        <Button
                          size="lg"
                          variant="outline"
                          className="w-full h-12 rounded-2xl font-bold text-sm border-primary/30 hover:bg-primary/5"
                        >
                          <TrendingUp className="h-4 w-4 mr-2" /> Renew Membership
                        </Button>
                      </Link>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Payment History */}
        {payments.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base font-bold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2 px-1">
              <Receipt className="h-4 w-4 text-primary" /> Payment History
            </h2>
            <Card className="glass-card overflow-hidden">
              <div className="divide-y divide-border/40">
                {payments.slice(0, 10).map((p) => (
                  <div key={p.id} className="px-4 py-4 flex items-center gap-3 text-sm hover:bg-muted/30 transition-colors">
                    <div
                      className={`h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 ${
                        p.status === "verified"
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : p.status === "rejected"
                            ? "bg-destructive/10 text-destructive border border-destructive/20"
                            : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                      }`}
                    >
                      {p.status === "verified" ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : p.status === "rejected" ? (
                        <XCircle className="h-5 w-5" />
                      ) : (
                        <Clock className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold capitalize">{p.package_id}</span>
                        <span className="text-xs font-semibold text-muted-foreground">
                          ${p.expected_amount}
                        </span>
                      </div>
                      <a
                        href={`https://celoscan.io/tx/${p.tx_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-mono text-muted-foreground hover:text-primary truncate block"
                      >
                        {p.tx_hash.slice(0, 16)}…{p.tx_hash.slice(-10)}
                      </a>
                      {p.admin_note && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic">
                          {p.admin_note}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full shrink-0 ${
                        p.status === "verified"
                          ? "bg-primary/10 text-primary"
                          : p.status === "rejected"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {p.status.replace("_", " ")}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* Footer hint */}
        <div className="flex items-center justify-center gap-2 py-4">
          <Shield className="h-3.5 w-3.5 text-primary/60" />
          <p className="text-xs text-muted-foreground font-medium">
            Only approve payments from inside your own wallet
          </p>
        </div>
      </main>

      {/* Add wallets dialog */}
      <Dialog open={!!openMembership} onOpenChange={(o) => !o && setOpenMembership(null)}>
        <DialogContent className="max-w-lg glass-card-elevated">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl premium-gradient flex items-center justify-center">
                <Plus className="h-4 w-4 text-primary-foreground" />
              </div>
              Add Locked Wallets
            </DialogTitle>
            <DialogDescription>
              {openMembership?.package_name} ·{" "}
              <span className="font-bold text-foreground">
                {openMembership && openMembership.wallet_slots - openMembership.locked_count} slots
              </span>{" "}
              remaining ({openMembership?.locked_count}/{openMembership?.wallet_slots} used)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <input
                type="file"
                id="wallet-file"
                accept=".txt,.csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <label htmlFor="wallet-file">
                <Button size="sm" variant="outline" asChild className="rounded-xl">
                  <span className="cursor-pointer">
                    <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload .txt / .csv
                  </span>
                </Button>
              </label>
              <span className="text-xs text-muted-foreground">or paste below</span>
            </div>
            <Textarea
              placeholder="0x...&#10;0x...&#10;0x..."
              rows={10}
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              className="font-mono text-xs rounded-xl"
            />
            <p className="text-xs text-muted-foreground">
              One address per line, or comma/space separated. Duplicates auto-skipped.
            </p>
            <Button
              size="lg"
              className="w-full h-12 rounded-2xl premium-gradient text-primary-foreground font-bold premium-shadow"
              onClick={submitWallets}
              disabled={submitting || !walletInput.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Adding…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" /> Lock Wallets
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tint: "primary" | "accent" | "success" | "warning";
}) {
  const tintMap = {
    primary: "bg-primary/10 text-primary border-primary/20",
    accent: "bg-accent/10 text-accent border-accent/20",
    success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  };
  return (
    <Card className="glass-card p-4 sm:p-5 relative overflow-hidden">
      <div className={`h-10 w-10 rounded-xl border flex items-center justify-center mb-3 ${tintMap[tint]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </p>
      <p className="text-2xl font-extrabold text-foreground leading-none">
        {value}
        {sub && <span className="text-xs text-muted-foreground font-medium ml-1">{sub}</span>}
      </p>
    </Card>
  );
}
