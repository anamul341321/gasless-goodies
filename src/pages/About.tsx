import { Link } from "react-router-dom";
import {
  ArrowLeft, Crown, Fuel, PiggyBank, Smartphone, Shield, Zap, Sparkles,
  Wallet, Layers, Globe, Users,
} from "lucide-react";
import appLogo from "@/assets/logo.png";

export default function About() {
  return (
    <div className="aurora-bg min-h-screen bg-background relative overflow-hidden">
      <header className="border-b border-border/40 backdrop-blur-2xl bg-card/60 sticky top-0 z-10">
        <div className="container max-w-3xl mx-auto py-3.5 px-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-primary font-semibold hover:underline underline-offset-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Home
          </Link>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto py-8 px-4 space-y-6 relative z-10">
        {/* Hero */}
        <section className="color-card card-violet shimmer-sheen p-7 text-center relative overflow-hidden">
          <div className="absolute -top-12 -right-12 h-44 w-44 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
          <div className="relative space-y-4">
            <img
              src={appLogo}
              alt="Celo Gas Sponsor by Good-App"
              className="h-20 w-20 rounded-3xl shadow-xl premium-shadow mx-auto"
              width={80}
              height={80}
            />
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">About</span>
            </div>
            <h1 className="text-3xl font-extrabold leading-tight">
              <span className="heading-shimmer">Celo Gas Sponsor</span>
              <span className="text-foreground"> by Good-App</span>
            </h1>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
              The fastest way to keep Celo wallets fueled. Free daily gas, batch loads for power users,
              passive yield on stablecoins, and instant mobile recharge — all from one premium dashboard.
            </p>
          </div>
        </section>

        {/* Mission */}
        <section className="color-card card-emerald shimmer-sheen p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="icon-chip icon-emerald h-11 w-11 rounded-2xl">
              <Zap className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-extrabold text-foreground">Our Mission</h2>
          </div>
          <p className="text-sm text-foreground/85 leading-relaxed">
            Onboarding to crypto should not be blocked by the gas problem. We sponsor Celo gas for everyone —
            new users get 2 free top-ups every day with no signup, and Buy IP members can fuel hundreds of locked
            wallets in batches. Self-custody stays intact: every payment is approved inside your own wallet.
          </p>
        </section>

        {/* What we offer */}
        <section className="space-y-3">
          <h2 className="text-base font-bold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2 px-1">
            <Layers className="h-4 w-4 text-primary" /> What We Offer
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <FeatureCard
              icon={Fuel}
              tone="cyan"
              title="Free Gas Loader"
              desc="Up to 2 Celo gas top-ups per day for any wallet — no signup, no fees, just instant gas."
            />
            <FeatureCard
              icon={Crown}
              tone="violet"
              title="Buy IP Membership"
              desc="Lock 300+ wallets, run unlimited batch gas loads with auto-pay starting from $17."
            />
            <FeatureCard
              icon={PiggyBank}
              tone="emerald"
              title="In-App Savings"
              desc="Deposit USDT or USDC, earn yield on your idle stablecoins, withdraw any time."
            />
            <FeatureCard
              icon={Smartphone}
              tone="rose"
              title="Mobile Recharge"
              desc="Top up any Bangladesh mobile number instantly — pay with crypto, receive in seconds."
            />
          </div>
        </section>

        {/* How it works */}
        <section className="color-card card-violet shimmer-sheen p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="icon-chip icon-violet h-11 w-11 rounded-2xl">
              <Globe className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-extrabold text-foreground">How It Works</h2>
          </div>
          <ol className="space-y-3">
            {[
              "Open the service you need — gas, savings, recharge, or Buy IP.",
              "Connect your Celo wallet. Your keys stay with you, always.",
              "Approve the payment from inside your wallet. Pricing is shown upfront.",
              "Our backend workers process your request 24/7, even if you close the app.",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="h-7 w-7 rounded-xl premium-gradient text-primary-foreground text-xs font-extrabold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm text-foreground/85 leading-relaxed pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Principles */}
        <section className="grid sm:grid-cols-2 gap-3">
          <PrincipleCard
            icon={Wallet}
            title="Self-custody first"
            desc="We never hold your keys. Every transaction is approved in your wallet."
          />
          <PrincipleCard
            icon={Shield}
            title="Transparent pricing"
            desc="Costs are shown before you pay. No hidden fees, no surprise deductions."
          />
          <PrincipleCard
            icon={Zap}
            title="Background processing"
            desc="Buy IP gas loads keep running on our servers even when your app is closed."
          />
          <PrincipleCard
            icon={Users}
            title="Built for Bangladesh"
            desc="Mobile recharge, local utilities and a community-first approach."
          />
        </section>

        <div className="text-center space-y-2 pt-2">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-primary" />
            <span>Independent utility platform · Celo Mainnet</span>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 Celo Gas Sponsor by Good-App. All rights reserved.</p>
        </div>
      </main>
    </div>
  );
}

function FeatureCard({
  icon: Icon, tone, title, desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "violet" | "cyan" | "emerald" | "rose";
  title: string;
  desc: string;
}) {
  const card = `card-${tone}`;
  const chip = `icon-${tone}`;
  return (
    <div className={`color-card ${card} shimmer-sheen p-4 space-y-3`}>
      <div className={`icon-chip ${chip} h-11 w-11 rounded-2xl`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-bold text-foreground leading-tight">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">{desc}</p>
      </div>
    </div>
  );
}

function PrincipleCard({
  icon: Icon, title, desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/70 backdrop-blur p-4 space-y-2">
      <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="text-xs font-bold text-foreground">{title}</p>
      <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
    </div>
  );
}
