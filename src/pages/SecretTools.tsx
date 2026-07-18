import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Fuel, History, Sparkles, LogOut, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import Farmer from "./Farmer";

const FP_KEY = "secret_tools_fp_v1";

// SHA-256 hex of a string (browser SubtleCrypto)
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchServerFingerprint(): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_secret_tools_fingerprint");
  if (error || typeof data !== "string") return null;
  return data;
}

export default function SecretTools() {
  const { toast } = useToast();
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<number | null>(null);

  // On mount: trust saved fingerprint. Only revoke if server returns a DIFFERENT fingerprint.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const saved = localStorage.getItem(FP_KEY);
      if (!saved) { if (mounted) setUnlocked(false); return; }
      // Optimistically unlock so network hiccups don't lock the user out.
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

  // While unlocked: poll every 20s + listen to admin_settings realtime for instant lock-out.
  useEffect(() => {
    if (!unlocked) return;
    let active = true;

    const verify = async () => {
      const saved = localStorage.getItem(FP_KEY);
      const serverFp = await fetchServerFingerprint();
      if (!active) return;
      // Only lock when we successfully fetched a server fingerprint AND it differs.
      // Network errors / null responses must NOT lock the user out.
      if (saved && serverFp && saved !== serverFp) {
        localStorage.removeItem(FP_KEY);
        setUnlocked(false);
        toast({ title: "Access revoked", description: "The password was changed by admin.", variant: "destructive" });
      }
    };

    pollRef.current = window.setInterval(verify, 20000);
    const channel = supabase
      .channel("secret-tools-pw-watch")
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

  const lock = () => {
    localStorage.removeItem(FP_KEY);
    setUnlocked(false);
    setPw("");
  };

  // Initial loading state — avoid flashing the unlock screen for already-unlocked users.
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
            <h1 className="text-xl font-extrabold heading-shimmer">Restricted Tools</h1>
            <p className="text-xs text-muted-foreground">
              This area is private. Enter the access password to continue.
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
          <Link to="/" className="block text-center text-xs text-muted-foreground hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen aurora-bg bg-background relative">
      <div className="sticky top-0 z-30 border-b border-border/30 bg-card/80 backdrop-blur-xl">
        <div className="container max-w-5xl mx-auto px-5 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-bold uppercase tracking-widest text-foreground/80 truncate">
              Private Tools
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button asChild variant="ghost" size="sm" className="h-8 rounded-lg text-xs font-semibold">
              <Link to="/gas-loader-tool"><Fuel className="h-3.5 w-3.5 mr-1" />Gas Loader</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-8 rounded-lg text-xs font-semibold">
              <Link to="/batch-history-tool"><History className="h-3.5 w-3.5 mr-1" />History</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-8 rounded-lg text-xs font-semibold">
              <Link to="/daily-claim"><CalendarClock className="h-3.5 w-3.5 mr-1" />Daily Auto</Link>
            </Button>
            <Button onClick={lock} variant="ghost" size="sm" className="h-8 rounded-lg text-xs font-semibold text-muted-foreground" title="Lock">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <Farmer />
    </div>
  );
}
