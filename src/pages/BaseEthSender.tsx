import { useState, useMemo } from "react";
import { Link } from "@/lib/router-compat";
import { ethers } from "ethers";
import { ArrowLeft, Send, Play, Loader2, CheckCircle2, XCircle, Clock, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { getBaseProvider, parseAddressList, normalizeKey, runPool } from "@/lib/baseChain";

type Status = "pending" | "sending" | "success" | "failed";

type Row = {
  address: string;
  status: Status;
  tx?: string;
  error?: string;
};

function short(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function statusBadge(s: Status) {
  const map: Record<Status, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground", icon: <Clock className="h-3 w-3" /> },
    sending: { label: "Sending", cls: "bg-violet-500/15 text-violet-500", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    success: { label: "Sent", cls: "bg-emerald-500/15 text-emerald-500", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { label: "Failed", cls: "bg-red-500/15 text-red-500", icon: <XCircle className="h-3 w-3" /> },
  };
  const m = map[s];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${m.cls}`}>
      {m.icon} {m.label}
    </span>
  );
}

export default function BaseEthSender() {
  const [funderKey, setFunderKey] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [amount, setAmount] = useState("0.0001");
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const recipients = useMemo(() => parseAddressList(recipientsText), [recipientsText]);

  const totalNeeded = useMemo(() => {
    try {
      const a = ethers.parseEther(amount.trim() || "0");
      return a * BigInt(recipients.length);
    } catch {
      return 0n;
    }
  }, [amount, recipients.length]);

  const sent = rows.filter((r) => r.status === "success").length;
  const failed = rows.filter((r) => r.status === "failed").length;

  function update(idx: number, patch: Partial<Row>) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  async function run() {
    const funder = normalizeKey(funderKey);
    if (!funder) {
      toast({ title: "Invalid funder private key", variant: "destructive" });
      return;
    }
    if (recipients.length === 0) {
      toast({ title: "No valid recipient addresses", variant: "destructive" });
      return;
    }
    let amountWei: bigint;
    try {
      amountWei = ethers.parseEther(amount.trim());
      if (amountWei <= 0n) throw new Error("Amount must be > 0");
    } catch {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }

    setRunning(true);
    try {
      const provider = await getBaseProvider();
      const wallet = new ethers.Wallet(funder, provider);

      const balance = await provider.getBalance(wallet.address);
      const minRequired = amountWei * BigInt(recipients.length);
      if (balance < minRequired) {
        toast({
          title: "Insufficient ETH",
          description: `Have ${ethers.formatEther(balance)} ETH, need at least ${ethers.formatEther(minRequired)} ETH (plus gas)`,
          variant: "destructive",
        });
        setRunning(false);
        return;
      }

      const initialRows: Row[] = recipients.map((a) => ({ address: a, status: "pending" as Status }));
      setRows(initialRows);

      const startNonce = await provider.getTransactionCount(wallet.address, "pending");
      const fee = await provider.getFeeData();

      recipients.forEach((_, i) => update(i, { status: "sending" }));
      await runPool(recipients, 50, async (to, i) => {
        try {
          const tx = await wallet.sendTransaction({
            to,
            value: amountWei,
            nonce: startNonce + i,
            maxFeePerGas: fee.maxFeePerGas ?? undefined,
            maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? undefined,
          });
          // Mark success on broadcast — no global wait needed
          update(i, { status: "success", tx: tx.hash });
        } catch (e) {
          const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ||
            (e as Error)?.message || String(e);
          update(i, { status: "failed", error: msg.slice(0, 120) });
        }
      });

      toast({ title: "Multi-send finished" });
    } catch (e) {
      toast({
        title: "Error",
        description: (e as Error)?.message || String(e),
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="aurora-bg min-h-screen bg-background">
      <header className="border-b border-border/30 bg-card/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="container max-w-2xl mx-auto py-3.5 px-5 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link to="/"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-base font-extrabold heading-shimmer leading-tight truncate">
              Base ETH Multi-Sender
            </h1>
            <p className="text-[11px] text-muted-foreground font-semibold truncate">
              Send Base ETH (gas) to many wallets
            </p>
          </div>
        </div>
      </header>

      <main className="container max-w-2xl mx-auto py-5 px-5 space-y-5">
        <div className="color-card card-violet p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Main Private Key (Base ETH source)
            </label>
            <Input
              type="password"
              placeholder="0x..."
              value={funderKey}
              onChange={(e) => setFunderKey(e.target.value)}
              disabled={running}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Amount per Wallet (ETH)
            </label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.0001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={running}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Recipient Addresses (one per line)
            </label>
            <Textarea
              placeholder="0xabc...&#10;0xdef..."
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              disabled={running}
              className="font-mono text-xs min-h-[160px]"
            />
            <p className="text-[10px] text-muted-foreground">
              {recipients.length} valid recipients · total needed:{" "}
              <span className="font-mono">{totalNeeded > 0n ? ethers.formatEther(totalNeeded) : "0"} ETH</span> + gas
            </p>
          </div>

          <Button onClick={run} disabled={running} className="w-full h-12 rounded-2xl font-bold">
            {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...</> : <><Play className="h-4 w-4 mr-2" /> Start Multi-Send</>}
          </Button>
        </div>

        {rows.length > 0 && (
          <div className="color-card card-indigo p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-card/60 border border-border/40 p-2 text-center">
                <p className="text-lg font-extrabold text-emerald-500">{sent}</p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Sent</p>
              </div>
              <div className="rounded-xl bg-card/60 border border-border/40 p-2 text-center">
                <p className="text-lg font-extrabold text-red-500">{failed}</p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Failed</p>
              </div>
            </div>

            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {rows.map((r, i) => (
                <div key={i} className="rounded-xl bg-card/60 border border-border/40 p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-[11px] font-mono">{short(r.address)}</code>
                    {statusBadge(r.status)}
                  </div>
                  {r.tx && (
                    <a
                      href={`https://basescan.org/tx/${r.tx}`}
                      target="_blank" rel="noreferrer"
                      className="text-[10px] text-primary font-semibold hover:underline break-all"
                    >
                      {r.tx.slice(0, 18)}...
                    </a>
                  )}
                  {r.error && <p className="text-[10px] text-red-500 break-all">{r.error}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-[11px] text-muted-foreground leading-relaxed flex gap-3">
          <Wallet className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-foreground text-xs mb-1">Browser-side execution</p>
            Your private key stays in this browser tab. Transactions are signed locally and broadcast directly to Base RPCs. Use small amounts to test first.
          </div>
        </div>
      </main>
    </div>
  );
}
