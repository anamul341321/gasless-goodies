import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import DailyClaim from "./DailyClaim";

const FP_KEY = "daily_claim_fp_v1";

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchServerFingerprint(): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_daily_claim_fingerprint");
  if (error || typeof data !== "string") return null;
  return data;
}

export default function DailyClaimGate() {
  const { toast } = useToast();
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const saved = localStorage.getItem(FP_KEY);
      if (!saved) { if (mounted) setUnlocked(false); return; }
      if (mounted) setUnlocked(true);
      const serverFp = await fetchServerFingerprint();
      if (!mounted) return;
      if (serverFp && serverFp !== saved) {
        localStorage.removeItem(FP_KEY);
        setUnlocked(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    let active = true;

    const verify = async () => {
      const saved = localStorage.getItem(FP_KEY);
      const serverFp = await fetchServerFingerprint();
      if (!active) return;
      if (saved && serverFp && saved !== serverFp) {
        localStorage.removeItem(FP_KEY);
        setUnlocked(false);
        toast({ title: "Access revoked", description: "Password was changed by admin.", variant: "destructive" });
      }
    };

    pollRef.current = window.setInterval(verify, 20000);
    const channel = supabase
      .channel("daily-claim-pw-watch")
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "admin_settings" },
        () => { verify(); })
      .subscribe();

    return () => {
      active = false;
      if (pollRef.current) window.clearInterval(pollRef.current);
      supabase.removeChannel(channel);
    };
  }, [unlocked, toast]);

  const tryUnlock = async () => {
    if (!pw) return;
    setChecking(true);
    try {
      const localFp = await sha256Hex(pw);
      const serverFp = await fetchServerFingerprint();
      if (serverFp && serverFp === localFp) {
        localStorage.setItem(FP_KEY, localFp);
        setUnlocked(true);
        toast({ title: "Access granted" });
      } else {
        toast({ title: "Wrong password", variant: "destructive" });
        setPw("");
      }
    } catch (e: any) {
      toast({ title: "Unlock failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  if (unlocked === null) {
    return <div className="min-h-screen aurora-bg bg-background" />;
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen aurora-bg bg-background flex items-center justify-center px-5">
        <div className="w-full max-w-sm color-card card-violet shimmer-sheen p-6 space-y-5">
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="icon-chip icon-violet h-14 w-14 rounded-2xl">
              <Lock className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-extrabold heading-shimmer">Daily Auto Claim</h1>
            <p className="text-xs text-muted-foreground">
              Enter the access password to continue. Once entered, it stays until admin changes it.
            </p>
          </div>
          <Input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
            placeholder="Access password"
            className="h-11 rounded-xl"
            autoFocus
          />
          <Button
            onClick={tryUnlock}
            disabled={checking || !pw}
            className="w-full h-11 rounded-xl font-bold"
          >
            {checking ? "Checking..." : "Unlock"}
          </Button>
          <Link to="/anamultools" className="block text-center text-xs text-muted-foreground hover:text-foreground">
            ← Back to Private Tools
          </Link>
        </div>
      </div>
    );
  }

  return <DailyClaim />;
}
