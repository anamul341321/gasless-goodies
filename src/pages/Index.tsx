import { useEffect, useState } from "react";
import {
  ArrowRight, Coins, Megaphone, Menu, Shield, Sparkles, Zap,
  CheckCircle2, Clock, Wallet, Lock, TrendingUp, User, LogIn, Send, Download,
  ShieldCheck, Volume2,
} from "lucide-react";
import { Link } from "@/lib/router-compat";
import appLogo from "@/assets/logo.png";
import { dashboardServices, historyServices } from "@/lib/dashboard-services";
import ServicesDrawer from "@/components/ServicesDrawer";
import VerifyGuide from "@/components/VerifyGuide";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const BRAND_TITLE = "Celo Gas Sponsor";
const BRAND_SUBTITLE = "by Good-App";

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
                title={user ? "আমার অ্যাকাউন্ট" : "লগইন"}
              >
                <Link to={user ? "/account" : "/auth"} aria-label={user ? "আমার অ্যাকাউন্ট" : "লগইন"}>
                  {user ? <User className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  <span className="hidden min-[380px]:inline">{user ? "অ্যাকাউন্ট" : "লগইন"}</span>
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
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/70">নোটিশ</p>
              <p className="text-sm font-semibold text-foreground leading-snug whitespace-pre-wrap break-words">
                {notice}
              </p>
            </div>
          </div>
        )}

        <Button asChild className="btn-premium w-full h-auto min-h-28 rounded-2xl px-6 py-6 text-left animate-fade-up">
          <Link to="/gas-loader">
            <Zap className="h-9 w-9 shrink-0" />
            <span className="flex-1 text-xl font-bold whitespace-normal leading-relaxed">ফ্রিতে গ্যাস ফি নিন</span>
            <ArrowRight className="h-6 w-6 shrink-0" />
          </Link>
        </Button>

        <section className="space-y-3">
          <h2 className="text-base font-bold">সব সুবিধা</h2>
          <div className="grid grid-cols-1 gap-3">
            {dashboardServices.map(({ to, icon: Icon, label, tone, iconTone }) => (
              <Button key={to} asChild variant="ghost" className={`color-card ${tone} shimmer-sheen h-auto min-h-20 w-full justify-start px-4 py-4 group`}>
                <Link to={to}>
                  <span className={`icon-chip ${iconTone} h-12 w-12 rounded-xl shrink-0 group-hover:scale-105 transition-transform`}><Icon className="h-5 w-5" /></span>
                  <span className="flex-1 text-base font-semibold text-foreground whitespace-normal text-left leading-relaxed">{label}</span>
                  <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </Link>
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-bold">আমার ইতিহাস</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {historyServices.map(({ to, icon: Icon, label }) => (
              <Button key={to} asChild variant="outline" className="h-auto min-h-14 whitespace-normal justify-start">
                <Link to={to}><Icon className="h-4 w-4 shrink-0" />{label}</Link>
              </Button>
            ))}
          </div>
        </section>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 h-10 rounded-xl text-xs"
            onClick={() => { setGuideTab("first"); setGuideOpen(true); }}>
            <Volume2 className="h-4 w-4" /> প্রথম ভেরিফিকেশন
          </Button>
          <Button size="sm" variant="outline" className="flex-1 h-10 rounded-xl text-xs"
            onClick={() => { setGuideTab("re"); setGuideOpen(true); }}>
            <ShieldCheck className="h-4 w-4" /> আবার ভেরিফিকেশন
          </Button>
        </div>
        <VerifyGuide open={guideOpen} onOpenChange={setGuideOpen} defaultTab={guideTab} />

        {/* Footer */}
        <footer className="text-center space-y-3 py-4">
          <div className="flex items-center justify-center gap-4 text-xs">
            <Link to="/about" className="text-primary font-semibold hover:underline">পরিচিতি</Link>
            <span className="text-border/60">·</span>
            <Link to="/terms" className="text-primary font-semibold hover:underline">শর্তাবলি</Link>
            <span className="text-border/60">·</span>
            <Link to="/privacy" className="text-primary font-semibold hover:underline">গোপনীয়তা</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
