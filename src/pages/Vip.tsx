import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, Check, Wallet, ArrowLeft, Zap, Clock, Shield, Loader2, Tag, TrendingDown, Sparkles, Flame, Calculator, Fuel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useWallet } from "@/hooks/useWallet";
import { BrowserProvider, Contract, parseUnits } from "ethers";

const USDT_ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

const EDGE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

type Pkg = {
  id: string;
  name: string;
  price_usdt: number;
  duration_days: number;
  wallet_slots: number;
  badge: string | null;
};

type Catalog = {
  packages: Pkg[];
  receiver: string;
  network: string;
  usdt_contract: string;
  chain_id: number;
};

// Gas economics constants
const GAS_PER_WALLET_PER_DAY_CELO = 0.032; // measured average
const FAUCET_DRIP_CELO = 0.15; // what GoodDollar faucet drips per call

// Tier discount based on wallet count: boro package = beshi discount
const tierDiscount = (slots: number): number => {
  if (slots >= 500) return 0.20;
  if (slots >= 400) return 0.18;
  if (slots >= 300) return 0.15;
  return 0.12;
};

// Duration discount: beshi mash = beshi discount
const durationDiscount = (m: number): number => {
  if (m >= 4) return 0.20;
  if (m >= 3) return 0.15;
  if (m >= 2) return 0.12;
  return 0.05;
};

// Combined discount: tier + duration, capped at 40%
const MAX_DISCOUNT = 0.40;
const combinedDiscount = (slots: number, m: number): number =>
  Math.min(MAX_DISCOUNT, tierDiscount(slots) + durationDiscount(m));

// Real monthly gas cost (USD) for a package
const realGasUsd = (slots: number, celoUsd: number) =>
  GAS_PER_WALLET_PER_DAY_CELO * 30 * slots * celoUsd;

// Effective per-month price = real gas cost × (1 - combined discount for 1mo), rounded to 2dp
// Used for the per-month "from $X" display on package cards. Matches dialog 1mo price.
const effectivePrice = (slots: number, celoUsd: number) => {
  const cost = realGasUsd(slots, celoUsd);
  const off = combinedDiscount(slots, 1);
  return Math.round(cost * (1 - off) * 100) / 100;
};

export default function Vip() {
  const wallet = useWallet();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Pkg | null>(null);
  const [months, setMonths] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [payStatus, setPayStatus] = useState("");
  const [celoPrice, setCeloPrice] = useState<number>(0.30);
  const [priceLoading, setPriceLoading] = useState(true);

  // Total = realGas × months × (1 - combined discount, capped at 40%)
  const computeTotal = (pkg: Pkg | null, m: number) => {
    if (!pkg) return 0;
    const realMonthly = realGasUsd(pkg.wallet_slots, celoPrice);
    const off = combinedDiscount(pkg.wallet_slots, m);
    return Math.round(realMonthly * m * (1 - off) * 100) / 100;
  };
  const totalPrice = computeTotal(selected, months);

  useEffect(() => {
    fetch(`${EDGE}/vip-packages`)
      .then((r) => r.json())
      .then((d) => setCatalog(d))
      .catch(() => toast.error("Failed to load packages"))
      .finally(() => setLoading(false));

    fetch(`${EDGE}/celo-price`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.price_usd && isFinite(Number(d.price_usd))) {
          setCeloPrice(Number(d.price_usd));
        }
      })
      .catch(() => {/* fallback already set */})
      .finally(() => setPriceLoading(false));
  }, []);


  const handlePayWithWallet = async () => {
    if (!wallet.address) {
      toast.error("Connect wallet first");
      return;
    }
    if (!selected || !catalog) return;
    if (!wallet.chainOk) {
      try {
        await wallet.switchToCelo();
      } catch {
        toast.error("Please switch to Celo network");
        return;
      }
    }
    if (!window.ethereum) {
      toast.error("No wallet provider found");
      return;
    }

    setSubmitting(true);
    try {
      setPayStatus("Preparing transaction…");
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const usdt = new Contract(catalog.usdt_contract, USDT_ERC20_ABI, signer);

      let decimals = 6;
      try {
        decimals = Number(await usdt.decimals());
      } catch {}

      const amount = parseUnits(totalPrice.toFixed(decimals), decimals);

      // Balance check
      try {
        const bal: bigint = await usdt.balanceOf(wallet.address);
        if (bal < amount) {
          toast.error(`Insufficient USDT. Need $${totalPrice} on Celo.`);
          setSubmitting(false);
          setPayStatus("");
          return;
        }
      } catch {}

      setPayStatus(`Sending $${totalPrice} USDT…`);
      const tx = await usdt.transfer(catalog.receiver, amount);
      setPayStatus("Waiting for confirmation…");
      await tx.wait();
      const txHash = tx.hash;

      setPayStatus("Verifying payment…");
      const res = await fetch(`${EDGE}/vip-submit-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_wallet: wallet.address,
          package_id: selected.id,
          tx_hash: txHash.toLowerCase(),
          months,
          client_total: totalPrice,
          celo_price: celoPrice,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Submission failed");
      } else if (data.status === "verified") {
        toast.success("Payment verified! Membership active 🎉");
        setSelected(null);
        setTimeout(() => (window.location.href = "/vip/dashboard"), 1200);
      } else {
        toast.info(data.message || "Submitted for review", { duration: 6000 });
        setSelected(null);
        setTimeout(() => (window.location.href = "/vip/dashboard"), 1500);
      }
    } catch (e: any) {
      const msg = e?.message || "Payment failed";
      if (msg.includes("user rejected") || msg.includes("User denied")) {
        toast.error("Transaction cancelled");
      } else {
        toast.error(msg);
      }
    }
    setSubmitting(false);
    setPayStatus("");
  };

  return (
    <div className="aurora-bg min-h-screen bg-background relative">
      <header className="border-b border-border/40 backdrop-blur-xl sticky top-0 z-10 bg-background/80">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {wallet.address ? (
              <Link to="/vip/dashboard">
                <Button variant="outline" size="sm" className="gap-2">
                  <Wallet className="h-4 w-4" />
                  <span className="font-mono text-xs">
                    {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                  </span>
                </Button>
              </Link>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  wallet.connect().catch((e) => toast.error(e?.message || "Connect failed"))
                }
                disabled={wallet.connecting}
                className="btn-premium text-primary-foreground gap-2"
              >
                <Wallet className="h-4 w-4" />
                {wallet.connecting ? "Connecting…" : "Connect Wallet"}
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 sm:py-12 relative z-10">
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full premium-gradient-subtle text-primary text-xs font-bold mb-4 border border-primary/20 premium-shadow">
            <Crown className="h-3.5 w-3.5 float-slow" /> Buy IP Membership
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold mb-3 tracking-tight">
            <span className="heading-shimmer">Unlimited Gas Loading</span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Pick a wallet tier, choose how many months, and pay USDT on Celo.
            Free users limited to 2 wallets/day per IP.
          </p>
        </div>

        {/* Discount system explainer — tier + duration, max 40% */}
        <div className="mb-8 rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-accent/[0.05] to-transparent p-5 sm:p-6 relative overflow-hidden animate-fade-in">
          <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-9 w-9 rounded-xl premium-gradient flex items-center justify-center premium-shadow">
                <TrendingDown className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Discount System</p>
                <p className="text-sm font-extrabold text-foreground">
                  Tier + Duration stack — max <span className="heading-shimmer">40% OFF</span>
                </p>
              </div>
            </div>

            {/* Tier row */}
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Bulk tier (boro package = beshi off)
            </p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { slots: 300, off: 10, label: "300 Wallets", cls: "tier-sky", anim: "animate-bounce-soft" },
                { slots: 400, off: 15, label: "400 Wallets", cls: "tier-fuchsia", anim: "animate-tilt" },
                { slots: 500, off: 20, label: "500 Wallets", cls: "tier-gold", anim: "animate-bounce-soft" },
              ].map((d) => (
                <div
                  key={d.slots}
                  className={`color-card shimmer-sheen rounded-2xl p-2.5 text-center ${d.cls} ${d.anim} hover:scale-[1.04] transition-transform`}
                >
                  <p className="text-[10px] font-extrabold uppercase tracking-wider opacity-90">
                    {d.label}
                  </p>
                  <p className="text-base sm:text-xl font-extrabold leading-none mt-1 drop-shadow-sm">
                    +{d.off}%
                  </p>
                </div>
              ))}
            </div>

            {/* Duration row */}
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Duration (beshi mash = beshi off)
            </p>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { m: 1, off: 0, label: "1mo", cls: "bg-muted/40 border border-border/40 text-muted-foreground", anim: "" },
                { m: 2, off: 10, label: "2mo", cls: "dur-mint", anim: "animate-bounce-soft" },
                { m: 3, off: 15, label: "3mo", cls: "dur-indigo", anim: "animate-tilt" },
                { m: 4, off: 20, label: "4mo", cls: "dur-rose", anim: "animate-bounce-soft" },
              ].map((d) => (
                <div
                  key={d.m}
                  className={`color-card shimmer-sheen rounded-2xl p-2 text-center ${d.cls} ${d.anim} hover:scale-[1.04] transition-transform`}
                >
                  <p className="text-[10px] font-extrabold opacity-90">
                    {d.label}
                  </p>
                  <p className="text-sm sm:text-base font-extrabold leading-none mt-0.5 drop-shadow-sm">
                    {d.off === 0 ? "—" : `+${d.off}%`}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-center text-muted-foreground">
              Max combined discount = <b className="text-primary">40%</b> (e.g. 500 wallets + 4mo)
            </p>
          </div>
        </div>

        {/* Gas Cost Calculator — live CELO price */}
        <div className="mb-8 rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/[0.08] via-primary/[0.04] to-transparent p-5 sm:p-6 relative overflow-hidden animate-fade-in">
          <div className="absolute -top-10 -left-10 h-32 w-32 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-10 -right-10 h-32 w-32 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center premium-shadow">
                <Calculator className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-accent">Gas Cost Calculator</p>
                <p className="text-sm font-extrabold text-foreground">
                  Real cost vs our price — <span className="heading-shimmer">koto $ save hocche</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">CELO live</p>
                <p className="text-sm font-extrabold text-foreground">
                  {priceLoading ? "…" : `$${celoPrice.toFixed(4)}`}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Per wallet daily ≈ <b className="text-foreground">{GAS_PER_WALLET_PER_DAY_CELO} CELO</b> · 30 din run korle ekta wallet er real cost = <b className="text-foreground">{(GAS_PER_WALLET_PER_DAY_CELO * 30).toFixed(2)} CELO</b> ≈ <b className="text-primary">${(GAS_PER_WALLET_PER_DAY_CELO * 30 * celoPrice).toFixed(2)}</b>
            </p>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {catalog?.packages.map((p) => {
                const slots = p.wallet_slots;
                const monthlyGasUsd = realGasUsd(slots, celoPrice);
                const tierOff = tierDiscount(slots);
                const ourPrice = effectivePrice(slots, celoPrice);
                const savedUsd = Math.max(0, monthlyGasUsd - ourPrice);
                // Unique theme per tier (no more all-same)
                const theme =
                  slots >= 500 ? "tier-gold"
                  : slots >= 400 ? "tier-fuchsia"
                  : "tier-sky";
                const wiggle =
                  slots >= 500 ? "animate-bounce-soft"
                  : slots >= 400 ? "animate-tilt"
                  : "animate-bounce-soft";
                return (
                  <div
                    key={p.id}
                    className={`color-card shimmer-sheen rounded-2xl p-2.5 sm:p-3 ${theme} ${wiggle} hover:scale-[1.03] transition-transform`}
                  >
                    <div className="flex items-center gap-1 mb-1.5">
                      <Fuel className="h-3 w-3 text-white drop-shadow" />
                      <p className="text-[10px] font-extrabold uppercase tracking-wider opacity-95">
                        {slots} wallets
                      </p>
                    </div>
                    <p className="text-[9px] font-semibold mb-0.5 opacity-85">
                      Real gas /mo
                    </p>
                    <p className="text-sm sm:text-base font-extrabold leading-none line-through opacity-75">
                      ${monthlyGasUsd.toFixed(2)}
                    </p>
                    <div className="mt-1.5 pt-1.5 border-t border-white/25">
                      <p className="text-[9px] font-semibold mb-0.5 opacity-95">
                        Our price ({Math.round(tierOff * 100)}% off)
                      </p>
                      <p className="text-base sm:text-lg font-extrabold leading-none drop-shadow">
                        ${ourPrice.toFixed(2)}
                      </p>
                    </div>
                    <div className="save-chip mt-2">
                      <TrendingDown className="h-2.5 w-2.5" />
                      save ${savedUsd.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-3">
              Price live CELO rate er sathe auto adjust hoy • Source: CoinGecko
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-muted-foreground">Loading packages…</div>
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-5">
              {catalog?.packages.map((p, idx) => {
                const isElite = p.id === "elite";
                const tierOff = tierDiscount(p.wallet_slots);
                const monthOff = combinedDiscount(p.wallet_slots, 1);
                const fourMoOff = combinedDiscount(p.wallet_slots, 4);
                const monthlyGasUsd = +realGasUsd(p.wallet_slots, celoPrice).toFixed(2);
                const base = +effectivePrice(p.wallet_slots, celoPrice).toFixed(2);
                const total4mo = +(monthlyGasUsd * 4 * (1 - fourMoOff)).toFixed(2);
                const real4mo = +(monthlyGasUsd * 4).toFixed(2);
                const save4mo = Math.max(0, +(real4mo - total4mo).toFixed(2));
                const gasSavedUsd = Math.max(0, +(monthlyGasUsd - base).toFixed(2));
                return (
                  <Card
                    key={p.id}
                    style={{ animationDelay: `${idx * 90}ms` }}
                    className={`p-6 flex flex-col relative overflow-hidden animate-scale-in transition-all duration-300 hover:-translate-y-1 ${
                      isElite
                        ? "premium-glow border-primary/40 ring-1 ring-primary/30 bg-gradient-to-b from-primary/[0.06] to-transparent"
                        : "border-border/40 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/10"
                    }`}
                  >
                    {isElite && (
                      <div className="absolute inset-0 pointer-events-none opacity-60 premium-gradient-subtle" />
                    )}
                    {p.badge && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full premium-gradient text-primary-foreground premium-shadow">
                        {p.badge}
                      </span>
                    )}
                    <div className="relative">
                      <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                        {p.name}
                        {isElite && <Crown className="h-4 w-4 text-primary float-slow" />}
                      </h3>
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-4xl font-extrabold heading-shimmer">${base.toFixed(2)}</span>
                        <span className="text-sm text-muted-foreground">USDT / mo</span>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-muted-foreground line-through">${monthlyGasUsd}</span>
                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          −{Math.round(monthOff * 100)}% OFF
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        {p.wallet_slots} wallets • Stack 1–4 months
                      </p>

                      {/* Real gas cost vs our price — koto save hocche */}
                      <div className="mb-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-2.5 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground inline-flex items-center gap-1">
                            <Fuel className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> Real gas /mo
                          </span>
                          <span className="font-bold text-muted-foreground line-through">
                            ${monthlyGasUsd}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-foreground inline-flex items-center gap-1">
                            <Sparkles className="h-3 w-3 text-emerald-600 dark:text-emerald-400 animate-wiggle" /> You save /mo
                          </span>
                          <span className="text-base save-number">
                            ${gasSavedUsd} <span className="text-[10px] font-bold">({Math.round(monthOff * 100)}%)</span>
                          </span>
                        </div>
                      </div>

                      {/* 4mo total preview */}
                      <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/[0.04] p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground inline-flex items-center gap-1">
                            <Tag className="h-3 w-3 text-primary" /> 4 months total
                          </span>
                          <span className="font-bold text-foreground">
                            ${total4mo.toFixed(2)}
                            <span className="text-muted-foreground line-through ml-1.5 font-normal">
                              ${real4mo.toFixed(2)}
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">You save</span>
                          <span className="save-chip save-chip-lg">
                            <TrendingDown className="h-3 w-3" /> ${save4mo.toFixed(2)} ({Math.round(fourMoOff * 100)}%)
                          </span>
                        </div>
                      </div>

                      <ul className="space-y-2 mb-6 text-sm">
                        <li className="flex gap-2">
                          <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span>Lock up to <b>{p.wallet_slots} wallets</b></span>
                        </li>
                        <li className="flex gap-2">
                          <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span>Unlimited gas load while active</span>
                        </li>
                        <li className="flex gap-2">
                          <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span>Tier <b className="text-primary">+{Math.round(tierOff * 100)}%</b> off + duration up to +20% (max 40%)</span>
                        </li>
                        <li className="flex gap-2">
                          <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span>Priority faucet processing</span>
                        </li>
                      </ul>
                      <Button
                        className={`mt-auto w-full ${isElite ? "btn-premium text-primary-foreground" : ""}`}
                        variant={isElite ? "default" : "outline"}
                        onClick={() => {
                          if (!wallet.address) {
                            wallet
                              .connect()
                              .then(() => setSelected(p))
                              .catch((e) => toast.error(e?.message || "Connect failed"));
                            return;
                          }
                          setSelected(p);
                        }}
                      >
                        {wallet.address ? `Buy ${p.name}` : "Connect to Buy"}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>

            <div className="mt-10 grid sm:grid-cols-3 gap-4 text-center animate-fade-in">
              <div className="glass-card p-4 hover:premium-shadow transition-shadow">
                <Zap className="h-5 w-5 text-primary mx-auto mb-2 float-slow" />
                <p className="text-sm font-semibold">Instant Activation</p>
                <p className="text-xs text-muted-foreground">Auto-verified on-chain</p>
              </div>
              <div className="glass-card p-4 hover:premium-shadow transition-shadow">
                <Clock className="h-5 w-5 text-primary mx-auto mb-2 float-slow" />
                <p className="text-sm font-semibold">Multiple Packages</p>
                <p className="text-xs text-muted-foreground">Stack 350×N wallets</p>
              </div>
              <div className="glass-card p-4 hover:premium-shadow transition-shadow">
                <Shield className="h-5 w-5 text-primary mx-auto mb-2 float-slow" />
                <p className="text-sm font-semibold">Celo Network</p>
                <p className="text-xs text-muted-foreground">Low fees (~$0.001)</p>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Payment Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o && !submitting) { setSelected(null); setMonths(1); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto border-primary/30 bg-gradient-to-b from-background via-background to-primary/[0.04]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <Crown className="h-5 w-5 text-primary float-slow" />
              <span className="heading-shimmer">Pay ${totalPrice} USDT</span>
            </DialogTitle>
            <DialogDescription>
              Choose duration, then tap <b>Pay ${totalPrice} USDT</b>. Payment will be sent from your connected wallet on <b>Celo</b> automatically — no manual transaction hash needed.
            </DialogDescription>
          </DialogHeader>

          {/* Duration selector — sundor discount preview */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
                <Tag className="h-3 w-3 text-primary" /> Choose Duration
              </Label>
              <span className="text-[10px] font-semibold text-primary">
                {selected ? `Tier +${Math.round(tierDiscount(selected.wallet_slots) * 100)}% baseline` : ""}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((m) => {
                const active = months === m;
                const monthTotal = computeTotal(selected, m);
                const combined = selected ? combinedDiscount(selected.wallet_slots, m) : 0;
                const isBest = m === 4;
                const capped = combined >= MAX_DISCOUNT && selected
                  && (tierDiscount(selected.wallet_slots) + durationDiscount(m)) > MAX_DISCOUNT;
                // Unique color per duration (active state)
                const activeTheme =
                  m === 4 ? "tier-gold"
                  : m === 3 ? "dur-rose"
                  : m === 2 ? "dur-indigo"
                  : "dur-mint";
                return (
                  <button
                    key={m}
                    onClick={() => setMonths(m)}
                    className={`relative rounded-2xl p-2.5 text-center transition-all overflow-hidden ${
                      active
                        ? `${activeTheme} scale-[1.05] shimmer-sheen`
                        : "border-2 border-border/40 bg-card hover:border-primary/40 hover:scale-[1.02]"
                    }`}
                  >
                    {isBest && (
                      <span className={`absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                        active
                          ? "bg-white text-orange-600 shadow"
                          : "premium-gradient text-primary-foreground"
                      } animate-bounce-soft`}>
                        BEST
                      </span>
                    )}
                    <div className={`text-sm font-extrabold ${active ? "text-white drop-shadow" : ""}`}>{m}mo</div>
                    <div className={`text-[13px] font-extrabold mt-0.5 ${active ? "text-white drop-shadow" : "text-foreground"}`}>
                      ${monthTotal}
                    </div>
                    <div className={`text-[9px] font-extrabold mt-1 px-1.5 py-0.5 rounded-full inline-block ${
                      active
                        ? "bg-white/25 text-white"
                        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    }`}>
                      −{Math.round(combined * 100)}%{capped ? " max" : ""}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Full price breakdown — always show, even for 1mo */}
            {selected && (
              <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-accent/[0.04] to-transparent p-3 space-y-1.5 animate-fade-in">
                {(() => {
                  const slots = selected.wallet_slots;
                  const tierOff = tierDiscount(slots);
                  const durOff = durationDiscount(months);
                  const rawSum = tierOff + durOff;
                  const finalOff = combinedDiscount(slots, months);
                  const isCapped = rawSum > MAX_DISCOUNT;
                  const realMonthly = realGasUsd(slots, celoPrice);
                  const realTotal = realMonthly * months;
                  const totalSaved = realTotal - totalPrice;
                  return (
                    <>
                      {/* Original price — BIG, RED, line-through, eye-catching */}
                      <div className="rounded-2xl border-2 border-rose-400/50 bg-gradient-to-r from-rose-500/10 via-orange-500/10 to-rose-500/10 p-3 mb-1 animate-fade-in">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
                            <Fuel className="h-3.5 w-3.5" />
                            Original gas cost ({months}mo)
                          </span>
                          <span className="text-2xl sm:text-3xl font-black line-through decoration-rose-500 decoration-[3px] text-rose-600 dark:text-rose-400 leading-none drop-shadow-sm">
                            ${realTotal.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1">
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                          <TrendingDown className="h-3 w-3 text-emerald-600" />
                          Bulk tier ({slots} wallets)
                        </span>
                        <span className="pct-badge">+{Math.round(tierOff * 100)}%</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                          <Tag className="h-3 w-3 text-primary" />
                          Duration ({months}mo)
                        </span>
                        <span className={durOff > 0 ? "pct-badge pct-badge-gold" : "text-muted-foreground font-bold"}>
                          {durOff > 0 ? `+${Math.round(durOff * 100)}%` : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] border-t border-border/40 pt-1.5">
                        <span className="font-semibold text-foreground inline-flex items-center gap-1.5">
                          <Sparkles className="h-3 w-3 text-primary animate-wiggle" />
                          Total discount {isCapped && <span className="cap-badge"><Flame className="h-2.5 w-2.5" />CAP 40%</span>}
                        </span>
                        <span className="text-base save-number">
                          −{Math.round(finalOff * 100)}%
                        </span>
                      </div>

                      {/* You pay — BIG, GREEN/PRIMARY, with prominent save badge */}
                      <div className="border-t-2 border-primary/30 pt-2 mt-1">
                        <div className="flex items-end justify-between gap-2">
                          <span className="text-sm font-extrabold text-foreground inline-flex items-center gap-1.5">
                            <Sparkles className="h-4 w-4 text-primary animate-wiggle" /> You pay
                          </span>
                          <div className="text-right">
                            <div className="text-3xl sm:text-4xl font-black heading-shimmer leading-none">${totalPrice}</div>
                            <div className="text-[10px] font-semibold text-muted-foreground mt-0.5">USDT total</div>
                          </div>
                        </div>
                        {/* Big save banner — full width, very visible */}
                        <div className="mt-2 rounded-xl save-chip save-chip-lg w-full justify-center py-2 text-sm">
                          <TrendingDown className="h-4 w-4" />
                          You save ${totalSaved.toFixed(2)} ({Math.round(finalOff * 100)}% OFF)
                        </div>
                      </div>

                      <p className="text-[10px] text-muted-foreground text-center pt-1">
                        {selected.duration_days * months} days · ${(totalPrice / months).toFixed(2)}/month · CELO ${celoPrice.toFixed(4)}
                      </p>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {!wallet.chainOk && wallet.address && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs">
              <p className="text-amber-600 dark:text-amber-400 mb-2">
                Your wallet is not on Celo network.
              </p>
              <Button size="sm" variant="outline" onClick={() => wallet.switchToCelo()}>
                Switch to Celo
              </Button>
            </div>
          )}

          <div className="space-y-3">
            <div className="rounded-lg bg-primary/5 border border-primary/10 p-3 text-xs space-y-1">
              <p>✅ One-tap payment from your connected wallet</p>
              <p>✅ Auto-verified on-chain (~30 seconds)</p>
              <p>❌ Wrong amount or wrong network = rejected</p>
            </div>

            {payStatus && (
              <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 text-xs text-center text-primary font-medium animate-fade-in">
                {payStatus}
              </div>
            )}

            <Button
              className="w-full btn-premium text-primary-foreground font-bold h-11"
              onClick={handlePayWithWallet}
              disabled={submitting || !wallet.address}
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
              ) : (
                <>Pay ${totalPrice} USDT</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
