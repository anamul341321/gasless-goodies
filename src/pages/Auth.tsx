import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "@/lib/router-compat";
import { oauthReturnPath } from "@/lib/oauth-return-path";
import { ArrowLeft, Loader2, Mail, Wallet as WalletIcon } from "lucide-react";
import { BrowserProvider } from "ethers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export default function Auth() {
  const nav = useNavigate();
  const { toast } = useToast();
  const [sp] = useSearchParams();
  const nextPath = oauthReturnPath(sp.get("next"));
  const hasNext = nextPath !== "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  const [walletBusy, setWalletBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleEmail = async () => {
    if (!email || !password) {
      toast({ title: "ইমেইল ও পাসওয়ার্ড দিন", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: hasNext ? new URL(nextPath, window.location.origin).href : window.location.origin },
        });
        if (error) throw error;
        try { localStorage.setItem("show_verify_guide", "first"); } catch {}
        toast({ title: "অ্যাকাউন্ট তৈরি হয়েছে", description: "লগইন হয়েছে।" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: "স্বাগতম" });
      }
      if (hasNext) { window.location.href = nextPath; return; }
      nav(mode === "signup" ? "/" : "/account");
    } catch (e: any) {
      toast({
        title: mode === "signup" ? "অ্যাকাউন্ট তৈরি হয়নি" : "লগইন হয়নি",
        description: e?.message || "আবার চেষ্টা করুন",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: hasNext ? new URL(nextPath, window.location.origin).href : window.location.origin + "/account",
        extraParams: { prompt: "select_account" },
      });
      if (result.error) throw result.error;
      if (result.redirected) return; // browser handles redirect
      if (hasNext) { window.location.href = nextPath; return; }
      nav("/account");
    } catch (e: any) {
      toast({
        title: "Google দিয়ে লগইন হয়নি",
        description: e?.message || "আবার চেষ্টা করুন",
        variant: "destructive",
      });
      setGoogleBusy(false);
    }
  };

  const handleWallet = async () => {
    if (!(window as any).ethereum) {
      toast({
        title: "ওয়ালেট পাওয়া যায়নি",
        description: "MetaMask বা অন্য ওয়ালেট অ্যাপ ব্যবহার করুন।",
        variant: "destructive",
      });
      return;
    }
    setWalletBusy(true);
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const wallet = String(accounts?.[0] || "").toLowerCase();
      if (!wallet) throw new Error("No wallet selected");

      // 1. Get nonce + message
      const nonceRes = await fetch(`${SUPABASE_URL}/functions/v1/siwe-nonce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: wallet }),
      });
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok) throw new Error(nonceData?.error || "Could not get nonce");

      // 2. Ask wallet to sign the message
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(nonceData.message);

      // 3. Verify and get session tokens
      const verifyRes = await fetch(`${SUPABASE_URL}/functions/v1/siwe-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: wallet,
          nonce: nonceData.nonce,
          message: nonceData.message,
          signature,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData?.error || "Verification failed");

      // 4. Apply session
      const { error: setErr } = await supabase.auth.setSession({
        access_token: verifyData.access_token,
        refresh_token: verifyData.refresh_token,
      });
      if (setErr) throw setErr;

      toast({ title: "ওয়ালেট যুক্ত হয়েছে", description: `Signed in as ${wallet.slice(0, 6)}…${wallet.slice(-4)}` });
      if (hasNext) { window.location.href = nextPath; return; } nav("/account");
    } catch (e: any) {
      toast({
        title: "ওয়ালেট দিয়ে লগইন হয়নি",
        description: e?.message || "আবার চেষ্টা করুন",
        variant: "destructive",
      });
    } finally {
      setWalletBusy(false);
    }
  };

  return (
    <div className="min-h-screen aurora-bg relative overflow-hidden flex items-center">
      <div className="pointer-events-none absolute -top-32 -left-24 w-80 h-80 rounded-full bg-primary/25 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 w-96 h-96 rounded-full bg-accent/30 blur-3xl animate-pulse" />
      <div className="container max-w-md mx-auto px-4 py-8 relative">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 hover:-translate-x-1 transition-transform">
          <ArrowLeft className="size-4" /> ড্যাশবোর্ডে ফিরুন
        </Link>

        <div className="animate-fade-up rounded-3xl p-[1.5px] bg-gradient-to-br from-primary via-accent to-primary shadow-2xl">
          <div className="rounded-[calc(1.5rem-1.5px)] bg-card/95 backdrop-blur-xl p-6 sm:p-8 space-y-5">
            <div className="text-center space-y-2">
              <div className="mx-auto grid place-items-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground text-2xl font-black shadow-lg">G</div>
              <h1 className="text-3xl font-black tracking-tight">স্বাগতম</h1>
              <p className="text-sm text-muted-foreground"></p>
            </div>

            <Button
              onClick={handleGoogle}
              disabled={googleBusy}
              className="premium-btn w-full flex items-center justify-center gap-3 rounded-2xl bg-foreground text-background py-4 text-base font-bold shadow-lg hover:-translate-y-0.5 disabled:opacity-60"
            >
              {googleBusy ? <Loader2 className="size-5 animate-spin" /> : (
                <svg className="size-5" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
              )}
              Google দিয়ে লগইন
            </Button>

            <Button
              onClick={handleWallet}
              disabled={walletBusy}
              className="premium-btn w-full flex items-center justify-center gap-3 rounded-2xl border border-border bg-muted/40 py-3.5 font-semibold hover:-translate-y-0.5 disabled:opacity-60"
            >
              {walletBusy ? <Loader2 className="size-5 animate-spin" /> : <WalletIcon className="size-5" />}
              ওয়ালেট দিয়ে লগইন
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center"><span className="bg-card px-3 text-xs uppercase tracking-widest text-muted-foreground">অথবা ইমেইল</span></div>
            </div>

            <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
              <TabsList className="grid grid-cols-2 w-full rounded-full h-11">
                <TabsTrigger value="signin" className="rounded-full">লগইন</TabsTrigger>
                <TabsTrigger value="signup" className="rounded-full">নতুন অ্যাকাউন্ট</TabsTrigger>
              </TabsList>
              <div className="space-y-3 mt-4 animate-fade-up" key={mode}>
                <Input className="h-12 rounded-xl" type="email" placeholder="ইমেইল" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Input className="h-12 rounded-xl" type="password" placeholder={mode === "signup" ? "পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)" : "পাসওয়ার্ড"} value={password} onChange={(e) => setPassword(e.target.value)} />
                <Button onClick={handleEmail} disabled={busy} className="premium-btn w-full h-12 rounded-xl text-base font-bold">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                  {mode === "signup" ? "অ্যাকাউন্ট তৈরি করুন" : "ইমেইল দিয়ে লগইন"}
                </Button>
              </div>
              <TabsContent value="signin" /><TabsContent value="signup" />
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
