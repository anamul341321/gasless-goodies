import { ChevronRight, Coins, History, Smartphone, User, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

const services = [
  {
    to: "/claim",
    icon: Coins,
    label: "Batch G$ Claim",
    desc: "Auto-claim daily GoodDollar · auto gas refill",
    badge: "NEW",
  },
  {
    to: "/claim-history",
    icon: History,
    label: "Claim History",
    desc: "Your past G$ claim batches",
  },
  {
    to: "/recharge",
    icon: Smartphone,
    label: "Mobile Recharge",
    desc: "GP, Robi, Banglalink, Airtel, Teletalk, Skitto",
    badge: "Popular",
  },
  {
    to: "/account",
    icon: User,
    label: "My Account",
    desc: "Profile and session",
  },
];

interface ServicesDrawerProps {
  children: React.ReactNode;
}

export default function ServicesDrawer({ children }: ServicesDrawerProps) {
  const [mobileRechargeEnabled, setMobileRechargeEnabled] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.rpc("get_safe_admin_settings").then(({ data }) => {
      if (!mounted) return;
      const row = Array.isArray(data) ? data[0] : null;
      if (row && typeof row.mobile_recharge_enabled === "boolean") {
        setMobileRechargeEnabled(row.mobile_recharge_enabled);
      }
    });
    const channel = supabase
      .channel("services-drawer-settings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_settings" },
        (payload: any) => {
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

  const visibleServices = services.filter(
    (s) => s.to !== "/recharge" || mobileRechargeEnabled
  );

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md border-l border-border/40 bg-background/95 backdrop-blur-2xl p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <SheetTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Services
          </SheetTitle>
        </SheetHeader>

        <div className="px-5 py-5 space-y-3">
          <p className="text-sm text-muted-foreground px-1">Pay for useful everyday services in Bangladesh</p>

          {visibleServices.map(({ to, icon: Icon, label, desc, badge }) => (
            <Link key={to} to={to} className="block">
              <div className="glass-card flex items-center gap-4 px-5 py-4 group hover:border-primary/20 hover:shadow-lg transition-all duration-300">
                <div className="h-12 w-12 rounded-2xl premium-gradient-subtle flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-semibold text-foreground">{label}</p>
                    {badge && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full premium-gradient text-primary-foreground">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0 group-hover:text-primary transition-colors" />
              </div>
            </Link>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border/40 mt-auto">
          <p className="text-xs text-muted-foreground text-center">Celo Gas Sponsor by Good-App ⚡</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
