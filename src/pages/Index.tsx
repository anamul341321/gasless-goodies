import { useEffect, useState } from "react";
import {
  ArrowRight, Coins, Fuel, Megaphone, Menu, Shield, Smartphone,
  Sparkles, Zap, CheckCircle2, Clock, Wallet, Lock, TrendingUp, User,
} from "lucide-react";
import { Link } from "react-router-dom";
import appLogo from "@/assets/logo.png";
import ServicesDrawer from "@/components/ServicesDrawer";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const BRAND_TITLE = "Celo Gas Sponsor";
const BRAND_SUBTITLE = "by Good-App";

const quickLinks = [
  {
    to: "/gas-loader",
    icon: Fuel,
    label: "Batch Gas Loader",
    desc: "Sponsor gas for many wallets · rotates IP per wallet",
    cardClass: "card-violet",
    iconClass: "icon-violet",
    badge: "Tool",
  },
  {
    to: "/claim",
    icon: Coins,
    label: "Batch G$ Claim",
    desc: "Auto-claim daily GoodDollar · auto gas refill on fail",
    cardClass: "card-indigo",
    iconClass: "icon-indigo",
    badge: "NEW",
  },
  {
    to: "/recharge",
    icon: Smartphone,
    label: "Mobile Recharge",
    desc: "Top up any Bangladesh number · instant",
    cardClass: "card-rose",
    iconClass: "icon-rose",
    badge: "Popular",
  },
];

const stats = [
  { icon: Wallet, label: "Wallets Loaded", value: "12K+" },
  { icon: Fuel, label: "Gas Sponsored", value: "Daily" },
  { icon: Shield, label: "Self-Custody", value: "100%" },
];

const features = [
  { icon: Lock, title: "Non-custodial", desc: "Your keys, your wallet — always" },
  { icon: Zap, title: "Instant", desc: "Gas arrives in seconds, not minutes" },
  { icon: TrendingUp, title: "Earn yield", desc: "Park USDT/USDC, earn passive returns" },
  { icon: Clock, title: "24/7 ready", desc: "Background workers run round the clock" },
];

export default function Index() {
  const { user } = useAuth();
  const [notice, setNotice] = useState<string>("");
  const [mobileRechargeEnabled, setMobileRechargeEnabled] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const { data } = await supabase.rpc("get_safe_admin_settings");
      if (!mounted) return;
      const row = Array.isArray(data) ? data[0] : null;
      if (row && typeof row.notice_message === "string") {
        setNotice(row.notice_message.trim());
      }
      if (row && typeof row.mobile_recharge_enabled === "boolean") {
        setMobileRechargeEnabled(row.mobile_recharge_enabled);
      }
    };
    refresh();
    const channel = supabase
      .channel("admin-settings-notice")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_settings" },
        (payload: any) => {
          const next = payload?.new?.notice_message;
          if (typeof next === "string") setNotice(next.trim());
          const mr = payload?.new?.mobile_recharge_enabled;
          if (typeof mr === "boolean") setMobileRechargeEnabled(mr);
        }
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const visibleLinks = quickLinks.filter(
    (l) => l.to !== "/recharge" || mobileRechargeEnabled
  );

  return (
    <div className="aurora-bg min-h-screen bg-background relative overflow-hidden">
      {/* Header */}
      <header className="border-b border-border/30 bg-card/80 backdrop-blur-xl relative z-20 sticky top-0">
        <div className="container max-w-lg mx-auto py-3.5 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={appLogo}
                alt="Celo Gas Sponsor by Good-App"
                className="h-11 w-11 rounded-2xl shadow-lg premium-shadow shrink-0"
                width={44}
                height={44}
              />
              <div className="min-w-0">
                <h1 className="text-base font-extrabold tracking-tight flex items-center gap-1.5 heading-shimmer leading-tight truncate">
                  {BRAND_TITLE}
                  <Sparkles className="h-3.5 w-3.5 text-primary float-slow shrink-0" />
                </h1>
                <p className="text-[11px] text-muted-foreground font-semibold truncate">{BRAND_SUBTITLE}</p>
              </div>
            </div>
            <ServicesDrawer>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-primary/10 shrink-0">
                <Menu className="h-5 w-5 text-foreground" />
              </Button>
            </ServicesDrawer>
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto py-5 px-5 space-y-6 relative z-10">
        {/* Live admin notice */}
        {notice && (
          <div className="color-card card-amber shimmer-sheen p-4 flex items-start gap-3 animate-fade-in">
            <span className="icon-chip icon-amber h-9 w-9 rounded-xl shrink-0">
              <Megaphone className="h-4 w-4" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/70">Notice</p>
              <p className="text-sm font-semibold text-foreground leading-snug whitespace-pre-wrap break-words">
                {notice}
              </p>
            </div>
          </div>
        )}

        {/* Hero */}
        <section className="color-card card-violet shimmer-sheen p-6 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 h-44 w-44 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 h-36 w-36 rounded-full bg-accent/20 blur-3xl pointer-events-none" />
          <div className="relative space-y-5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
              <Zap className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Powered by Good-App</span>
            </div>
            <div className="space-y-2">
              <h2 className="text-[26px] font-extrabold leading-[1.15]">
                <span className="heading-shimmer">Celo gas, </span>
                <span className="text-foreground">free every day.</span>
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sponsor wallet gas and pay for everyday services on Celo — fast, secure, non-custodial.
              </p>
            </div>

            {/* Stat row */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              {stats.map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-2xl bg-card/60 border border-border/40 backdrop-blur p-2.5 text-center">
                  <Icon className="h-4 w-4 text-primary mx-auto mb-1" />
                  <p className="text-sm font-extrabold text-foreground leading-none">{value}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Big CTA */}
            <div className="pt-1">
              <Link
                to="/claim"
                className="btn-premium inline-flex w-full items-center justify-center gap-2 rounded-2xl h-12 px-4 text-sm font-bold text-primary-foreground"
              >
                <Coins className="h-4 w-4" /> Start Batch G$ Claim
              </Link>
            </div>
          </div>
        </section>

        {/* Section heading — Services */}
        <div className="flex items-center justify-between px-1">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Services
          </p>
          <span className="text-[10px] font-semibold text-muted-foreground/70">Tap to open</span>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 gap-3">
          {visibleLinks.map(({ to, icon: Icon, label, desc, cardClass, iconClass, badge }) => (
            <Link key={to} to={to} className="block">
              <div className={`color-card ${cardClass} shimmer-sheen p-4 flex items-center gap-4 group`}>
                <div className={`icon-chip ${iconClass} h-12 w-12 rounded-2xl group-hover:scale-105 transition-transform`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-foreground leading-tight">{label}</p>
                    {badge && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground/50 shrink-0 group-hover:text-foreground group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
          ))}
        </div>

        {/* Why us / features */}
        <div className="space-y-3">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest inline-flex items-center gap-1.5 px-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Why Good-App
          </p>
          <div className="grid grid-cols-2 gap-3">
            {features.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="color-card card-violet shimmer-sheen p-3.5 space-y-2"
              >
                <div className="icon-chip icon-violet h-9 w-9 rounded-xl">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground leading-tight">{title}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trust strip */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
          <div className="icon-chip icon-violet h-10 w-10 rounded-xl shrink-0">
            <Shield className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-foreground">Wallet-first security</p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Only approve payments inside your own wallet. We never hold your keys.
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center space-y-3 py-4">
          <div className="flex items-center justify-center gap-4 text-xs">
            <Link to="/about" className="text-primary font-semibold hover:underline">About</Link>
            <span className="text-border/60">·</span>
            <Link to="/terms" className="text-primary font-semibold hover:underline">Terms</Link>
            <span className="text-border/60">·</span>
            <Link to="/privacy" className="text-primary font-semibold hover:underline">Privacy</Link>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 Celo Gas Sponsor by Good-App · All rights reserved</p>
        </footer>
      </main>
    </div>
  );
}
