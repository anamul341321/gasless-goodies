import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Shield, Lock, LogIn, Save, MessageSquare, CheckCircle2, Clock, XCircle, Fuel, Power, PowerOff, ArrowRight, History as HistoryIcon, Smartphone, Key, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";


const EDGE_FUNCTION_BASE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

interface RechargeRequest {
  id: string;
  phone_number: string;
  operator: string;
  amount_bdt: number;
  amount_gd: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  wallet_address: string;
}

export default function Admin() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [gasLoaderEnabled, setGasLoaderEnabled] = useState(true);
  const [mobileRechargeEnabled, setMobileRechargeEnabled] = useState(true);
  const [secretToolsPassword, setSecretToolsPassword] = useState("");
  const [savingSecretPw, setSavingSecretPw] = useState(false);
  const [dailyClaimPassword, setDailyClaimPassword] = useState("");
  const [savingDailyPw, setSavingDailyPw] = useState(false);
  const [purgingGroups, setPurgingGroups] = useState(false);
  const [togglingLoader, setTogglingLoader] = useState(false);
  const [togglingRecharge, setTogglingRecharge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState<RechargeRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);

  const handleLogin = async () => {
    const pw = password.trim();
    if (!pw) return;
    try {
      const res = await fetch(`${EDGE_FUNCTION_BASE}/admin-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": pw },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setAuthenticated(true);
        const data = await res.json();
        setNoticeMessage(data.notice_message || "");
        setGasLoaderEnabled(data.gas_loader_enabled !== false);
        setMobileRechargeEnabled(data.mobile_recharge_enabled !== false);
        setSecretToolsPassword(data.secret_tools_password || "");
        setDailyClaimPassword(data.daily_claim_password || "");
        sessionStorage.setItem("gl_admin_pw", pw);
        toast.success("Admin login successful ✅");
        fetchRequests();
      } else {
        toast.error("Wrong password ❌");
      }
    } catch {
      toast.error("Server error");
    }
  };

  const toggleGasLoader = async (next: boolean) => {
    setTogglingLoader(true);
    // Optimistic update
    setGasLoaderEnabled(next);
    try {
      const res = await fetch(`${EDGE_FUNCTION_BASE}/admin-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password.trim() },
        body: JSON.stringify({ gas_loader_enabled: next }),
      });
      if (res.ok) {
        toast.success(next ? "Gas loader enabled ✅" : "Gas loader disabled 🚫");
      } else {
        setGasLoaderEnabled(!next);
        toast.error("Failed to update");
      }
    } catch {
      setGasLoaderEnabled(!next);
      toast.error("Server error");
    }
    setTogglingLoader(false);
  };

  const toggleMobileRecharge = async (next: boolean) => {
    setTogglingRecharge(true);
    setMobileRechargeEnabled(next);
    try {
      const res = await fetch(`${EDGE_FUNCTION_BASE}/admin-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password.trim() },
        body: JSON.stringify({ mobile_recharge_enabled: next }),
      });
      if (res.ok) {
        toast.success(next ? "Mobile recharge enabled ✅" : "Mobile recharge hidden 🚫");
      } else {
        setMobileRechargeEnabled(!next);
        toast.error("Failed to update");
      }
    } catch {
      setMobileRechargeEnabled(!next);
      toast.error("Server error");
    }
    setTogglingRecharge(false);
  };

  const fetchRequests = async () => {
    setLoadingRequests(true);
    try {
      const res = await fetch(`${EDGE_FUNCTION_BASE}/recharge-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin", password: password.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setRequests(Array.isArray(data) ? data : []);
      } else {
        setRequests([]);
      }
    } catch {
      setRequests([]);
    }
    setLoadingRequests(false);
  };

  const saveNotice = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${EDGE_FUNCTION_BASE}/admin-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password.trim() },
        body: JSON.stringify({ notice_message: noticeMessage }),
      });
      if (res.ok) toast.success("Notice saved ✅");
    } catch {}
    setSaving(false);
  };

  const saveSecretToolsPassword = async () => {
    const pw = secretToolsPassword.trim();
    if (pw.length < 4) {
      toast.error("Password must be at least 4 characters");
      return;
    }
    setSavingSecretPw(true);
    try {
      const res = await fetch(`${EDGE_FUNCTION_BASE}/admin-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password.trim() },
        body: JSON.stringify({ secret_tools_password: pw }),
      });
      if (res.ok) {
        toast.success("Secret tools password updated ✅ All devices will be locked out.");
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error || "Failed to update password");
      }
    } catch {
      toast.error("Server error");
    }
    setSavingSecretPw(false);
  };

  const saveDailyClaimPassword = async () => {
    const pw = dailyClaimPassword.trim();
    if (pw.length < 4) {
      toast.error("Password must be at least 4 characters");
      return;
    }
    setSavingDailyPw(true);
    try {
      const res = await fetch(`${EDGE_FUNCTION_BASE}/admin-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password.trim() },
        body: JSON.stringify({ daily_claim_password: pw }),
      });
      if (res.ok) {
        toast.success("Daily Claim password updated ✅ All devices will be locked out.");
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error || "Failed to update password");
      }
    } catch {
      toast.error("Server error");
    }
    setSavingDailyPw(false);
  };

  const purgeAllGroups = async () => {
    if (!window.confirm("Delete ALL Daily Auto Claim groups, wallets and history? This cannot be undone.")) return;
    setPurgingGroups(true);
    try {
      const res = await fetch(`${EDGE_FUNCTION_BASE}/daily-claim-purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password.trim() },
        body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("All Daily Auto Claim groups & data removed ✅");
      } else {
        toast.error(j?.error || "Failed to purge");
      }
    } catch {
      toast.error("Server error");
    }
    setPurgingGroups(false);
  };


  useEffect(() => {
    if (authenticated) {
      const interval = setInterval(fetchRequests, 15000);
      return () => clearInterval(interval);
    }
  }, [authenticated]);

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (status === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-warning" />;
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="glass-card rounded-3xl p-8 max-w-sm w-full space-y-6 animate-scale-in">
          <div className="text-center space-y-3">
            <div className="h-16 w-16 mx-auto rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
              <Lock className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Login</h1>
            <p className="text-sm text-muted-foreground">Enter password to continue</p>
          </div>
          <div className="space-y-4">
            <Input
              type="password"
              placeholder="Password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className="rounded-2xl h-12 text-center text-lg"
            />
            <Button onClick={handleLogin} className="w-full h-12 rounded-2xl bg-gradient-to-r from-primary to-accent text-primary-foreground font-bold text-base gap-2">
              <LogIn className="h-5 w-5" />
              Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="glass-card rounded-3xl p-6 text-center space-y-2 animate-fade-in">
          <div className="h-14 w-14 mx-auto rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
            <Shield className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage notices and request history</p>
        </div>

        {/* Notice Message */}
        <div className="glass-card rounded-2xl p-5 space-y-4 animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-info to-info/70 flex items-center justify-center shadow-sm">
              <MessageSquare className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-foreground">Notice Message</p>
              <p className="text-xs text-muted-foreground">Shown to users on the home page</p>
            </div>
          </div>
          <Textarea
            placeholder="Write a notice for users (leave empty to hide)..."
            value={noticeMessage}
            onChange={(e) => setNoticeMessage(e.target.value)}
            className="min-h-[100px] rounded-2xl"
          />
          <Button onClick={saveNotice} disabled={saving} className="w-full rounded-2xl gap-2 bg-gradient-to-r from-info to-info/80 text-primary-foreground font-bold">
            <Save className="h-4 w-4" />
            Save Notice
          </Button>
        </div>

        {/* Gas Loader Toggle */}
        <div className="glass-card rounded-2xl p-5 space-y-4 animate-slide-up">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-all ${
                gasLoaderEnabled
                  ? "bg-gradient-to-br from-primary to-accent shadow-primary/30"
                  : "bg-gradient-to-br from-destructive/80 to-destructive shadow-destructive/30"
              }`}>
                {gasLoaderEnabled
                  ? <Power className="h-5 w-5 text-primary-foreground" />
                  : <PowerOff className="h-5 w-5 text-primary-foreground" />}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-foreground flex items-center gap-1.5">
                  <Fuel className="h-4 w-4 text-primary" /> Gas Loader
                </p>
                <p className="text-xs text-muted-foreground">
                  {gasLoaderEnabled
                    ? "Live · users can submit jobs"
                    : "Disabled · button greyed out for users instantly"}
                </p>
              </div>
            </div>
            <Switch
              checked={gasLoaderEnabled}
              onCheckedChange={toggleGasLoader}
              disabled={togglingLoader}
            />
          </div>
        </div>

        {/* Mobile Recharge Toggle */}
        <div className="glass-card rounded-2xl p-5 space-y-4 animate-slide-up">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-all ${
                mobileRechargeEnabled
                  ? "bg-gradient-to-br from-primary to-accent shadow-primary/30"
                  : "bg-gradient-to-br from-destructive/80 to-destructive shadow-destructive/30"
              }`}>
                {mobileRechargeEnabled
                  ? <Power className="h-5 w-5 text-primary-foreground" />
                  : <PowerOff className="h-5 w-5 text-primary-foreground" />}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-foreground flex items-center gap-1.5">
                  <Smartphone className="h-4 w-4 text-primary" /> Mobile Recharge
                </p>
                <p className="text-xs text-muted-foreground">
                  {mobileRechargeEnabled
                    ? "Visible · users can see the recharge button"
                    : "Hidden · button removed from home page instantly"}
                </p>
              </div>
            </div>
            <Switch
              checked={mobileRechargeEnabled}
              onCheckedChange={toggleMobileRecharge}
              disabled={togglingRecharge}
            />
          </div>
        </div>

        {/* Secret Tools Password */}
        <div className="glass-card rounded-2xl p-5 space-y-4 animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-warning to-warning/70 flex items-center justify-center shadow-sm shrink-0">
              <Key className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-foreground">Private Tools Password</p>
              <p className="text-xs text-muted-foreground">
                Controls access to <code className="text-[10px] bg-muted/50 px-1 rounded">/anamultools</code>. Changing it instantly locks out all devices.
              </p>
            </div>
          </div>
          <Input
            type="text"
            placeholder="New password (min 4 chars)"
            value={secretToolsPassword}
            onChange={(e) => setSecretToolsPassword(e.target.value)}
            className="rounded-2xl h-11 font-mono"
          />
          <Button
            onClick={saveSecretToolsPassword}
            disabled={savingSecretPw || !secretToolsPassword.trim()}
            className="w-full rounded-2xl gap-2 bg-gradient-to-r from-warning to-warning/80 text-primary-foreground font-bold"
          >
            <Save className="h-4 w-4" />
            {savingSecretPw ? "Saving..." : "Update Password & Lock All Devices"}
          </Button>
        </div>

        {/* Daily Claim Password */}
        <div className="glass-card rounded-2xl p-5 space-y-4 animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-success to-success/70 flex items-center justify-center shadow-sm shrink-0">
              <Key className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-foreground">Daily Auto Claim Password</p>
              <p className="text-xs text-muted-foreground">
                Controls access to <code className="text-[10px] bg-muted/50 px-1 rounded">/daily-claim</code>. Changing it instantly locks out all devices.
              </p>
            </div>
          </div>
          <Input
            type="text"
            placeholder="New password (min 4 chars)"
            value={dailyClaimPassword}
            onChange={(e) => setDailyClaimPassword(e.target.value)}
            className="rounded-2xl h-11 font-mono"
          />
          <Button
            onClick={saveDailyClaimPassword}
            disabled={savingDailyPw || !dailyClaimPassword.trim()}
            className="w-full rounded-2xl gap-2 bg-gradient-to-r from-success to-success/80 text-primary-foreground font-bold"
          >
            <Save className="h-4 w-4" />
            {savingDailyPw ? "Saving..." : "Update Password & Lock All Devices"}
          </Button>
        </div>

        {/* Purge Daily Auto Claim Groups */}
        <div className="glass-card rounded-2xl p-5 space-y-4 animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-destructive to-destructive/70 flex items-center justify-center shadow-sm shrink-0">
              <Trash2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-foreground">Remove All Daily Auto Claim Groups</p>
              <p className="text-xs text-muted-foreground">
                Deletes every group, saved wallet, and run history across all users. Cannot be undone.
              </p>
            </div>
          </div>
          <Button
            onClick={purgeAllGroups}
            disabled={purgingGroups}
            className="w-full rounded-2xl gap-2 bg-gradient-to-r from-destructive to-destructive/80 text-primary-foreground font-bold"
          >
            <Trash2 className="h-4 w-4" />
            {purgingGroups ? "Deleting..." : "Delete All Groups & Wallets"}
          </Button>
        </div>





        {/* Gas Loader Tools (admin-only access) */}
        <div className="glass-card rounded-2xl p-5 space-y-3 animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-sm">
              <Fuel className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-foreground">Gas Loader Tools</p>
              <p className="text-xs text-muted-foreground">Internal batch faucet & history (admin only)</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link to="/admin/gas-loader">
              <Button variant="outline" className="w-full rounded-xl gap-2 justify-between">
                <span className="flex items-center gap-2"><Fuel className="h-4 w-4" /> Loader</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/admin/batch-history">
              <Button variant="outline" className="w-full rounded-xl gap-2 justify-between">
                <span className="flex items-center gap-2"><HistoryIcon className="h-4 w-4" /> History</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Request History */}
        <div className="glass-card rounded-2xl p-5 space-y-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-foreground">Request History</h2>
            <Button onClick={fetchRequests} variant="outline" size="sm" className="rounded-xl" disabled={loadingRequests}>
              {loadingRequests ? "..." : "Refresh"}
            </Button>
          </div>

          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No service requests yet</p>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {requests.map(req => (
                <div key={req.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium text-foreground">{req.phone_number} — {req.operator.toUpperCase()}</p>
                    <p className="text-[10px] text-muted-foreground">{req.amount_bdt}৳ • Paid amount: {req.amount_gd}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(req.created_at).toLocaleString()}</p>
                    {req.admin_note && <p className="text-[10px] text-warning">{req.admin_note}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {statusIcon(req.status)}
                    <span className="text-xs font-medium">{req.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
