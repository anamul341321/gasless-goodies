import { useState } from "react";
import { useNavigate, Link } from "@/lib/router-compat";
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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  const [walletBusy, setWalletBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleEmail = async () => {
    if (!email || !password) {
      toast({ title: "Email and password required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        try { localStorage.setItem("show_verify_guide", "first"); } catch {}
        toast({ title: "Account created", description: "You're signed in." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: "Welcome back" });
      }
      nav(mode === "signup" ? "/" : "/account");
    } catch (e: any) {
      toast({
        title: mode === "signup" ? "Sign up failed" : "Sign in failed",
        description: e?.message || "Try again",
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
        redirect_uri: window.location.origin + "/account",
      });
      if (result.error) throw result.error;
      if (result.redirected) return; // browser handles redirect
      nav("/account");
    } catch (e: any) {
      toast({
        title: "Google sign-in failed",
        description: e?.message || "Try again",
        variant: "destructive",
      });
      setGoogleBusy(false);
    }
  };

  const handleWallet = async () => {
    if (!(window as any).ethereum) {
      toast({
        title: "No wallet detected",
        description: "Install MetaMask or another EIP-1193 wallet.",
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

      toast({ title: "Wallet linked", description: `Signed in as ${wallet.slice(0, 6)}…${wallet.slice(-4)}` });
      nav("/account");
    } catch (e: any) {
      toast({
        title: "Wallet sign-in failed",
        description: e?.message || "Try again",
        variant: "destructive",
      });
    } finally {
      setWalletBusy(false);
    }
  };

  return (
    <div className="min-h-screen aurora-bg">
      <div className="container max-w-md mx-auto px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="size-4" /> Back to home
        </Link>

        <Card className="glass-card-elevated">
          <CardHeader>
            <CardTitle className="text-2xl">Sign in</CardTitle>
            <p className="text-sm text-muted-foreground">
              Access your batches and recover failed wallet keys anytime.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Google */}
            <Button
              variant="outline"
              className="w-full"
              onClick={handleGoogle}
              disabled={googleBusy}
            >
              {googleBusy ? <Loader2 className="size-4 animate-spin" /> : (
                <svg className="size-4" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1H12v3.2h5.35c-.23 1.45-1.7 4.25-5.35 4.25-3.22 0-5.85-2.66-5.85-5.95s2.63-5.95 5.85-5.95c1.84 0 3.07.78 3.78 1.45l2.58-2.5C16.7 3.95 14.55 3 12 3 6.93 3 2.85 7.08 2.85 12.15S6.93 21.3 12 21.3c6.93 0 9.5-4.85 9.5-7.85 0-.53-.05-.93-.15-1.35Z"/></svg>
              )}
              Continue with Google
            </Button>

            {/* Wallet */}
            <Button
              variant="outline"
              className="w-full"
              onClick={handleWallet}
              disabled={walletBusy}
            >
              {walletBusy ? <Loader2 className="size-4 animate-spin" /> : <WalletIcon className="size-4" />}
              Continue with Wallet
            </Button>

            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center"><span className="bg-card px-3 text-xs text-muted-foreground">or</span></div>
            </div>

            {/* Email */}
            <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>
              <TabsContent value="signin" className="space-y-3 mt-3">
                <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <Button onClick={handleEmail} disabled={busy} className="w-full">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                  Sign in with email
                </Button>
              </TabsContent>
              <TabsContent value="signup" className="space-y-3 mt-3">
                <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Input type="password" placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
                <Button onClick={handleEmail} disabled={busy} className="w-full">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                  Create account
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
