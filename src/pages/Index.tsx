import { useEffect, useState } from "react";
import {
  ArrowRight, Coins, Megaphone, Menu, Shield, Sparkles, Zap,
  CheckCircle2, Clock, Wallet, Lock, TrendingUp, User, LogIn, Send, Download,
  ShieldCheck, Volume2,
} from "lucide-react";
import { Link } from "@/lib/router-compat";
import appLogo from "@/assets/logo.png";
import ServicesDrawer from "@/components/ServicesDrawer";
import VerifyGuide from "@/components/VerifyGuide";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const BRAND_TITLE = "Celo Gas Sponsor";
const BRAND_SUBTITLE = "by Good-App";

const quickLinks = [
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
    to: "/nano-collect",
    icon: Download,
    label: "NanoPay Batch Collect",
    desc: "Collect NanoPay (Base) from many wallets · auto gas top-up",
    cardClass: "card-indigo",
    iconClass: "icon-indigo",
    badge: "BASE",
  },
  {
    to: "/base-multisend",
    icon: Send,
    label: "Base ETH Multi-Sender",
    desc: "Send Base ETH (gas) to many wallets from one key",
    cardClass: "card-violet",
    iconClass: "icon-violet",
    badge: "BASE",
  },
];

const stats = [
  { icon: Wallet, label: "Wallets Loaded", value: "12K+" },
  { icon: Coins, label: "G$ Claimed", value: "Daily" },
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
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideTab, setGuideTab] = useState<"first" | "re">("first");

  // Auto-open guide after fresh signup
  useEffect(() => {
    try {
      const flag = localStorage.getItem("show_verify_guide");
      if (flag) {
        setGuideTab(flag === "re" ? "re" : "first");
        setGuideOpen(true);
        localStorage.removeItem("show_verify_guide");
      }
    } catch {}
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const { data } = await supabase.rpc("get_safe_admin_settings");
      if (!mounted) return;
      const row = Array.isArray(data) ? data[0] : null;
      if (row && typeof row.notice_message === "string") {
        setNotice(row.notice_message.trim());
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
        }
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const visibleLinks = quickLinks;

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
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                asChild
                variant={user ? "default" : "outline"}
                size="sm"
                className="h-10 rounded-xl px-3 font-bold"
                title={user ? "My account" : "Sign in"}
              >
                <Link to={user ? "/account" : "/auth"} aria-label={user ? "My account" : "Sign in"}>
                  {user ? <User className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  <span className="hidden min-[380px]:inline">{user ? "Account" : "Login"}</span>
                </Link>
              </Button>
              <ServicesDrawer>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-primary/10">
                  <Menu className="h-5 w-5 text-foreground" />
                </Button>
              </ServicesDrawer>
            </div>
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

        {/* Daily Auto Claim — main button */}
        <Link to="/daily-claim" className="block animate-fade-up">
          <div className="btn-premium premium-btn rounded-3xl p-6 flex items-center gap-4 text-primary-foreground shadow-2xl hover:-translate-y-1">
            <div className="h-14 w-14 rounded-2xl bg-background/20 grid place-items-center shrink-0">
              <Clock className="h-7 w-7" />
            </div>
            <p className="flex-1 text-xl font-black">Daily Auto Claim</p>
            <ArrowRight className="h-6 w-6" />
          </div>
        </Link>

        <div className="grid grid-cols-1 gap-3">
          {quickLinks.map(({ to, icon: Icon, label, cardClass, iconClass }, i) => (
            <Link key={to} to={to} className="block animate-fade-up" style={{ animationDelay: `${(i + 1) * 70}ms` }}>
              <div className={`color-card ${cardClass} shimmer-sheen p-4 flex items-center gap-4 group`}>
                <div className={`icon-chip ${iconClass} h-12 w-12 rounded-2xl group-hover:scale-110 transition-transform`}>
                  <Icon className="h-5 w-5" />
                </div>
                <p className="flex-1 text-base font-bold text-foreground">{label}</p>
                <ArrowRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-foreground group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
          ))}
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 h-10 rounded-xl text-xs"
            onClick={() => { setGuideTab("first"); setGuideOpen(true); }}>
            <Volume2 className="h-4 w-4" /> First Verify
          </Button>
          <Button size="sm" variant="outline" className="flex-1 h-10 rounded-xl text-xs"
            onClick={() => { setGuideTab("re"); setGuideOpen(true); }}>
            <ShieldCheck className="h-4 w-4" /> Re-Verify
          </Button>
        </div>
        <VerifyGuide open={guideOpen} onOpenChange={setGuideOpen} defaultTab={guideTab} />

        {/* Footer */}
        <footer className="text-center space-y-3 py-4">
          <div className="flex items-center justify-center gap-4 text-xs">
            <Link to="/about" className="text-primary font-semibold hover:underline">About</Link>
            <span className="text-border/60">·</span>
            <Link to="/terms" className="text-primary font-semibold hover:underline">Terms</Link>
            <span className="text-border/60">·</span>
            <Link to="/privacy" className="text-primary font-semibold hover:underline">Privacy</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
