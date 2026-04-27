import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Coins, Copy, ExternalLink, Loader2, LogOut, Trash2,
  Wallet as WalletIcon, AlertTriangle, ChevronDown, ChevronRight, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Batch = {
  id: string;
  batch_name: string;
  total: number;
  done: number;
  failed: number;
  needs_gas: number;
  status: string;
  created_at: string;
  finished_at: string | null;
  failed_with_keys: number;
};

type FailedWallet = {
  wallet_address: string;
  status: string;
  error_message: string | null;
  private_key: string | null;
  processed_at: string | null;
};

export default function Account() {
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const nav = useNavigate();
  const { toast } = useToast();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [walletsByBatch, setWalletsByBatch] = useState<Record<string, FailedWallet[]>>({});
  const [walletsLoading, setWalletsLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!authLoading && !user) {
      nav("/auth");
    }
  }, [authLoading, user, nav]);

  const loadBatches = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_my_gd_claim_batches");
    if (error) {
      toast({ title: "Could not load batches", description: error.message, variant: "destructive" });
    } else {
      setBatches((data as Batch[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) loadBatches();
  }, [user]);

  const loadFailed = async (jobId: string) => {
    setWalletsLoading((s) => ({ ...s, [jobId]: true }));
    const { data, error } = await supabase.rpc("get_gd_claim_wallets", {
      p_job_id: jobId,
      p_requester: user?.id,
    });
    if (error) {
      toast({ title: "Could not load wallets", description: error.message, variant: "destructive" });
    } else {
      const failed = ((data as FailedWallet[]) || []).filter((w) => w.status === "failed");
      setWalletsByBatch((s) => ({ ...s, [jobId]: failed }));
    }
    setWalletsLoading((s) => ({ ...s, [jobId]: false }));
  };

  const toggle = async (jobId: string) => {
    const next = !expanded[jobId];
    setExpanded((s) => ({ ...s, [jobId]: next }));
    if (next && !walletsByBatch[jobId]) await loadFailed(jobId);
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  };

  const deleteKey = async (jobId: string, walletAddress: string) => {
    if (!confirm(`Permanently delete the private key for ${walletAddress.slice(0, 8)}…?\n\nThis cannot be undone.`)) return;
    const { data, error } = await supabase.rpc("delete_my_failed_key", {
      p_job_id: jobId,
      p_wallet_address: walletAddress,
    });
    if (error || data === false) {
      toast({ title: "Delete failed", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Key deleted" });
    setWalletsByBatch((s) => ({
      ...s,
      [jobId]: (s[jobId] || []).map((w) =>
        w.wallet_address.toLowerCase() === walletAddress.toLowerCase() ? { ...w, private_key: null } : w
      ),
    }));
    // Refresh batch counts
    loadBatches();
  };

  const copyAllKeys = (jobId: string) => {
    const wallets = (walletsByBatch[jobId] || []).filter((w) => w.private_key);
    if (wallets.length === 0) {
      toast({ title: "No keys to copy", variant: "destructive" });
      return;
    }
    const text = wallets.map((w) => w.private_key).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: `Copied ${wallets.length} private key${wallets.length === 1 ? "" : "s"}` });
  };

  const deleteAllKeys = async (jobId: string) => {
    const wallets = (walletsByBatch[jobId] || []).filter((w) => w.private_key);
    if (wallets.length === 0) {
      toast({ title: "No keys to delete", variant: "destructive" });
      return;
    }
    if (!confirm(`Permanently delete ALL ${wallets.length} private keys in this batch?\n\nThis cannot be undone. Make sure you copied them first if needed.`)) return;

    let success = 0;
    let failed = 0;
    for (const w of wallets) {
      const { data, error } = await supabase.rpc("delete_my_failed_key", {
        p_job_id: jobId,
        p_wallet_address: w.wallet_address,
      });
      if (error || data === false) failed++;
      else success++;
    }

    toast({
      title: `Deleted ${success} key${success === 1 ? "" : "s"}`,
      description: failed > 0 ? `${failed} failed to delete` : undefined,
      variant: failed > 0 ? "destructive" : "default",
    });

    setWalletsByBatch((s) => ({
      ...s,
      [jobId]: (s[jobId] || []).map((w) => ({ ...w, private_key: null })),
    }));
    loadBatches();
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const displayName = profile?.display_name || profile?.email || user.email || "User";
  const totalFailedKeys = batches.reduce((s, b) => s + Number(b.failed_with_keys || 0), 0);

  return (
    <div className="min-h-screen aurora-bg pb-12">
      <div className="container max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Home
          </Link>
          <Button variant="outline" size="sm" onClick={async () => { await signOut(); nav("/"); }}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>

        <Card className="glass-card-elevated mb-6">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-xl">{displayName}</CardTitle>
                <p className="text-sm text-muted-foreground capitalize">
                  Signed in via {profile?.auth_method || "email"}
                  {profile?.wallet_address && (
                    <span className="ml-2 font-mono text-xs">
                      · {profile.wallet_address.slice(0, 6)}…{profile.wallet_address.slice(-4)}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">{batches.length}</p>
                <p className="text-xs text-muted-foreground">batches</p>
              </div>
            </div>
          </CardHeader>
          {totalFailedKeys > 0 && (
            <CardContent className="pt-0">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
                <AlertTriangle className="size-4 text-warning shrink-0" />
                <span>
                  You have <strong>{totalFailedKeys}</strong> failed wallet{totalFailedKeys === 1 ? "" : "s"} with recoverable keys.
                </span>
              </div>
            </CardContent>
          )}
        </Card>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">My batches</h2>
          <Button variant="ghost" size="sm" onClick={loadBatches} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {loading ? (
          <Card className="glass-card"><CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin mx-auto mb-2" /> Loading…
          </CardContent></Card>
        ) : batches.length === 0 ? (
          <Card className="glass-card"><CardContent className="py-10 text-center">
            <Coins className="size-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">You haven't created any batches yet.</p>
            <Button asChild><Link to="/claim">Start a claim batch</Link></Button>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {batches.map((b) => (
              <Card key={b.id} className="glass-card">
                <CardHeader className="pb-3">
                  <button
                    onClick={() => toggle(b.id)}
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">{b.batch_name}</h3>
                        <Badge variant={b.status === "completed" ? "default" : "secondary"}>{b.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(b.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-center">
                        <p className="font-semibold text-success">{b.done}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">done</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-destructive">{b.failed}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">failed</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold">{b.total}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">total</p>
                      </div>
                      {expanded[b.id] ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </div>
                  </button>
                </CardHeader>
                {expanded[b.id] && (
                  <CardContent className="pt-0">
                    {Number(b.failed_with_keys) > 0 && (
                      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-xs text-muted-foreground">
                          <strong className="text-foreground">{b.failed_with_keys}</strong> failed wallet{Number(b.failed_with_keys) === 1 ? "" : "s"} have recoverable keys.
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => copyAllKeys(b.id)}>
                            <Copy className="size-3" /> Copy all keys
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-destructive hover:text-destructive border-destructive/40" onClick={() => deleteAllKeys(b.id)}>
                            <Trash2 className="size-3" /> Delete all
                          </Button>
                        </div>
                      </div>
                    )}
                    {walletsLoading[b.id] ? (
                      <div className="text-center py-4"><Loader2 className="size-4 animate-spin mx-auto" /></div>
                    ) : (walletsByBatch[b.id] || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No failed wallets in this batch.</p>
                    ) : (
                      <div className="space-y-2">
                        {(walletsByBatch[b.id] || []).map((w) => (
                          <div key={w.wallet_address} className="p-3 rounded-lg bg-muted/50 border border-border space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <WalletIcon className="size-3.5 text-muted-foreground shrink-0" />
                                <span className="font-mono text-xs truncate">{w.wallet_address}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => copy(w.wallet_address, "Address")}>
                                  <Copy className="size-3" />
                                </Button>
                                <a
                                  href={`https://celoscan.io/address/${w.wallet_address}`}
                                  target="_blank" rel="noreferrer"
                                  className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent"
                                >
                                  <ExternalLink className="size-3" />
                                </a>
                              </div>
                            </div>
                            {w.error_message && (
                              <p className="text-xs text-destructive/80 break-words">{w.error_message}</p>
                            )}
                            {w.private_key ? (
                              <div className="flex items-center gap-2">
                                <code className="flex-1 px-2 py-1.5 text-xs font-mono bg-background rounded border border-border truncate">
                                  {w.private_key.slice(0, 10)}…{w.private_key.slice(-8)}
                                </code>
                                <Button size="sm" variant="outline" className="h-7" onClick={() => copy(w.private_key!, "Private key")}>
                                  <Copy className="size-3" /> Copy
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={() => deleteKey(b.id, w.wallet_address)}>
                                  <Trash2 className="size-3" />
                                </Button>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">Key deleted by you.</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
