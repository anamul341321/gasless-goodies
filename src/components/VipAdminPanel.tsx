import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Crown, CheckCircle2, XCircle, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

const EDGE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

type Payment = {
  id: string;
  user_wallet: string;
  package_id: string;
  tx_hash: string;
  expected_amount: number;
  amount_usdt: number | null;
  status: string;
  admin_note: string | null;
  bsc_confirmations: number | null;
  created_at: string;
  vip_packages?: { name: string; duration_days: number };
};

export default function VipAdminPanel({ password }: { password: string }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const fetchPayments = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${EDGE}/vip-admin-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ action: "list", status: "manual_review" }),
      });
      const d = await r.json();
      setPayments(d.payments || []);
    } catch {
      toast.error("Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPayments();
    const i = setInterval(fetchPayments, 20000);
    return () => clearInterval(i);
  }, []);

  const decide = async (paymentId: string, action: "approve" | "reject") => {
    setActing(paymentId);
    try {
      const r = await fetch(`${EDGE}/vip-admin-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ action, payment_id: paymentId }),
      });
      if (r.ok) {
        toast.success(action === "approve" ? "Approved ✅" : "Rejected ❌");
        fetchPayments();
      } else {
        const d = await r.json();
        toast.error(d.error || "Failed");
      }
    } catch {
      toast.error("Network error");
    }
    setActing(null);
  };

  return (
    <div className="glass-card rounded-2xl p-5 space-y-4 animate-slide-up">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-foreground flex items-center gap-2">
          <Crown className="h-4 w-4 text-primary" /> Buy IP Payments — Manual Review
        </h2>
        <Button onClick={fetchPayments} variant="outline" size="sm" className="rounded-xl" disabled={loading}>
          {loading ? "..." : "Refresh"}
        </Button>
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No payments awaiting review 🎉
        </p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {payments.map((p) => (
            <div key={p.id} className="p-3 rounded-xl bg-muted/30 border border-border/50 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold capitalize">{p.package_id}</span>
                    <span className="text-xs text-muted-foreground">${p.expected_amount}</span>
                    {p.amount_usdt && (
                      <span className="text-[10px] text-success">paid: ${p.amount_usdt}</span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground truncate">
                    from: {p.user_wallet}
                  </p>
                  <a
                    href={`https://celoscan.io/tx/${p.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-primary inline-flex items-center gap-1 font-mono"
                  >
                    {p.tx_hash.slice(0, 14)}…{p.tx_hash.slice(-8)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {p.admin_note && (
                    <p className="text-[10px] text-warning mt-1">⚠ {p.admin_note}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(p.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs"
                  disabled={acting === p.id}
                  onClick={() => decide(p.id, "approve")}
                >
                  {acting === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs text-destructive hover:bg-destructive/10"
                  disabled={acting === p.id}
                  onClick={() => decide(p.id, "reject")}
                >
                  <XCircle className="h-3 w-3 mr-1" /> Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
