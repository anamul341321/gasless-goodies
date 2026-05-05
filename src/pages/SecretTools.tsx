import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, ArrowLeft, Fuel, History, Sparkles, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import Farmer from "./Farmer";

// Change this password to something only you know.
// Anyone with the URL still needs this password to enter.
const SECRET_PASSWORD = "gf-2026-secret";
const STORAGE_KEY = "secret_tools_unlocked_v1";

export default function SecretTools() {
  const { toast } = useToast();
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "1") setUnlocked(true);
  }, []);

  const tryUnlock = () => {
    setChecking(true);
    // Tiny delay to mitigate brute-force timing
    setTimeout(() => {
      if (pw === SECRET_PASSWORD) {
        localStorage.setItem(STORAGE_KEY, "1");
        setUnlocked(true);
        toast({ title: "Access granted" });
      } else {
        toast({ title: "Wrong password", variant: "destructive" });
        setPw("");
      }
      setChecking(false);
    }, 250);
  };

  const lock = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUnlocked(false);
    setPw("");
  };

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
      {/* Mini secret-tools toolbar */}
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
