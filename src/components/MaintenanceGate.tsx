import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "@/lib/router-compat";
import { Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** Routes that stay reachable even when everything is switched off */
const ALWAYS_ALLOWED = ["/admin", "/auth", "/terms", "/privacy", "/about"];

export default function MaintenanceGate({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data } = await supabase.rpc("get_safe_admin_settings");
      const row = Array.isArray(data) ? data[0] : data;
      if (!active) return;
      setEnabled(row && typeof row.all_tools_enabled === "boolean" ? row.all_tools_enabled : true);
    };
    load();

    const channel = supabase
      .channel("maintenance-gate")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "admin_settings" },
        (payload: any) => {
          const next = payload?.new?.all_tools_enabled;
          if (typeof next === "boolean") setEnabled(next);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const allowed = ALWAYS_ALLOWED.some((p) => location.pathname.startsWith(p));

  if (enabled === false && !allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="glass-card rounded-3xl p-8 max-w-sm w-full text-center space-y-4">
          <div className="h-14 w-14 mx-auto rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Wrench className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground">সাময়িকভাবে বন্ধ</h1>
          <p className="text-sm text-muted-foreground">
            রক্ষণাবেক্ষণের জন্য সব সার্ভিস কিছুক্ষণের জন্য বন্ধ রাখা হয়েছে। একটু পরে আবার চেষ্টা করুন।
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
