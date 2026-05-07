import { useState } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { ArrowLeft, Coins, Play, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  getBaseProvider,
  parseKeyList,
  normalizeKey,
  NANOPAY_TOKEN,
  ERC20_ABI,
} from "@/lib/baseChain";

type Status = "pending" | "checking" | "topup" | "sending" | "success" | "skipped_zero" | "skipped_nogas" | "failed";

type Row = {
  address: string;
  pk: string;
  status: Status;
  balance?: string;
  tx?: string;
  error?: string;
};

// Base ETH gas reserve per ERC20 transfer (Base is cheap)
const GAS_RESERVE = ethers.parseEther("0.00003");
const TOPUP_AMOUNT = ethers.parseEther("0.00006");

function short(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function statusBadge(s: Status) {
  const map: Record<Status, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground", icon: <Clock className="h-3 w-3" /> },
    checking: { label: "Checking", cls: "bg-blue-500/15 text-blue-500", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    topup: { label: "Gas top-up", cls: "bg-amber-500/15 text-amber-500", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    sending: { label: "Sending", cls: "bg-violet-500/15 text-violet-500", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    success: { label: "Sent", cls: "bg-emerald-500/15 text-emerald-500", icon: <CheckCircle2 className="h-3 w-3" /> },
    skipped_zero: { label: "Zero balance", cls: "bg-muted text-muted-foreground", icon: <XCircle className="h-3 w-3" /> },
    skipped_nogas: { label: "No gas", cls: "bg-orange-500/15 text-orange-500", icon: <XCircle className="h-3 w-3" /> },
    failed: { label: "Failed", cls: "bg-red-500/15 text-red-500", icon: <XCircle className="h-3 w-3" /> },
  };
  const m = map[s];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${m.cls}`}>
      {m.icon} {m.label}
    </span>
  );
}

export default function NanoCollect() {
  const [keysText, setKeysText] = useState("");
  const [receiver, setReceiver] = useState("");
  const [funderKey, setFunderKey] = useState("");
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [decimals, setDecimals] = useState<number>(18);

  const totalSent = rows.filter((r) => r.status === "success").length;
  const totalFailed = rows.filter((r) => r.status === "failed" || r.status === "skipped_nogas").length;
  const totalZero = rows.filter((r) => r.status === "skipped_zero").length;

  function update(idx: number, patch: Partial<Row>) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  async function run() {
    const keys = parseKeyList(keysText);
    if (keys.length === 0) {
      toast({ title: "No valid private keys", variant: "destructive" });
      return;
    }
    let receiverAddr = "";
    try {
      receiverAddr = ethers.getAddress(receiver.trim());
    } catch {
      toast({ title: "Invalid receiver address", variant: "destructive" });
      return;
    }
    const funder = normalizeKey(funderKey);
    if (!funder) {
      toast({ title: "Invalid funder private key", variant: "destructive" });
      return;
    }

    setRunning(true);
    try {
      const provider = await getBaseProvider();
      const funderWallet = new ethers.Wallet(funder, provider);
      const token = new ethers.Contract(NANOPAY_TOKEN, ERC20_ABI, provider);
      const dec: number = Number(await token.decimals());
      setDecimals(dec);

      const initialRows: Row[] = keys.map((pk) => {
        const w = new ethers.Wallet(pk);
        return { address: w.address, pk, status: "pending" as Status };
      });
      setRows(initialRows);

      // Get funder nonce manually to avoid races
      let funderNonce = await provider.getTransactionCount(funderWallet.address, "pending");
      const funderBalance = await provider.getBalance(funderWallet.address);
      let remainingFunder = funderBalance;

      for (let i = 0; i < initialRows.length; i++) {
        const row = initialRows[i];
        const wallet = new ethers.Wallet(row.pk, provider);
        try {
          update(i, { status: "checking" });
          const bal: bigint = await token.balanceOf(wallet.address);
          if (bal === 0n) {
            update(i, { status: "skipped_zero", balance: "0" });
            continue;
          }
          update(i, { balance: ethers.formatUnits(bal, dec) });

          let ethBal = await provider.getBalance(wallet.address);
          if (ethBal < GAS_RESERVE) {
            // top-up from funder
            if (remainingFunder < TOPUP_AMOUNT + GAS_RESERVE) {
              update(i, { status: "skipped_nogas", error: "Funder out of ETH" });
              continue;
            }
            update(i, { status: "topup" });
            try {
              const fee = await provider.getFeeData();
              const tx = await funderWallet.sendTransaction({
                to: wallet.address,
                value: TOPUP_AMOUNT,
                nonce: funderNonce++,
                maxFeePerGas: fee.maxFeePerGas ?? undefined,
                maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? undefined,
              });
              await tx.wait();
              remainingFunder -= TOPUP_AMOUNT + GAS_RESERVE;
              ethBal = await provider.getBalance(wallet.address);
            } catch (e) {
              const msg = (e as Error)?.message || String(e);
              update(i, { status: "skipped_nogas", error: "Top-up failed: " + msg.slice(0, 80) });
              continue;
            }
          }

          update(i, { status: "sending" });
          const tokenW = new ethers.Contract(NANOPAY_TOKEN, ERC20_ABI, wallet);
          const tx = await tokenW.transfer(receiverAddr, bal);
          await tx.wait();
          update(i, { status: "success", tx: tx.hash });
        } catch (e) {
          const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ||
            (e as Error)?.message || String(e);
          update(i, { status: "failed", error: msg.slice(0, 120) });
        }
      }

      toast({ title: "Collection finished" });
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
              NanoPay Batch Collect
            </h1>
            <p className="text-[11px] text-muted-foreground font-semibold truncate">
              Base network · auto gas top-up
            </p>
          </div>
        </div>
      </header>

      <main className="container max-w-2xl mx-auto py-5 px-5 space-y-5">
        <div className="color-card card-violet p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Funder Private Key (Base ETH for gas top-ups)
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
              Receiver Address (where all NanoPay will be sent)
            </label>
            <Input
              placeholder="0x..."
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              disabled={running}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Source Wallet Private Keys (one per line)
            </label>
            <Textarea
              placeholder="0xabc...&#10;0xdef..."
              value={keysText}
              onChange={(e) => setKeysText(e.target.value)}
              disabled={running}
              className="font-mono text-xs min-h-[160px]"
            />
            <p className="text-[10px] text-muted-foreground">
              {parseKeyList(keysText).length} valid keys detected · keys never leave your browser
            </p>
          </div>

          <Button onClick={run} disabled={running} className="w-full h-12 rounded-2xl font-bold">
            {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running...</> : <><Play className="h-4 w-4 mr-2" /> Start Collection</>}
          </Button>
        </div>

        {rows.length > 0 && (
          <div className="color-card card-indigo p-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-card/60 border border-border/40 p-2 text-center">
                <p className="text-lg font-extrabold text-emerald-500">{totalSent}</p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Sent</p>
              </div>
              <div className="rounded-xl bg-card/60 border border-border/40 p-2 text-center">
                <p className="text-lg font-extrabold text-muted-foreground">{totalZero}</p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Zero bal</p>
              </div>
              <div className="rounded-xl bg-card/60 border border-border/40 p-2 text-center">
                <p className="text-lg font-extrabold text-red-500">{totalFailed}</p>
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
                  {r.balance !== undefined && (
                    <p className="text-[10px] text-muted-foreground">Balance: {r.balance} NANO</p>
                  )}
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

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-[11px] text-muted-foreground leading-relaxed">
          <p className="font-bold text-foreground text-xs mb-1.5 flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-primary" /> How it works
          </p>
          Each source wallet's full NanoPay balance is transferred to the receiver. If a source wallet has no Base ETH for gas, a small amount is auto-sent from your funder key. Everything runs in your browser — keys never leave this device.
          <span className="block mt-1 font-mono text-[10px]">Token: {NANOPAY_TOKEN}</span>
        </div>
      </main>
    </div>
  );
}
