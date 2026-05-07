import { useState } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { ArrowLeft, Coins, Play, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  getBaseProviderPool,
  parseKeyList,
  normalizeKey,
  NANOPAY_TOKEN,
  ERC20_ABI,
  MULTICALL3_ABI,
  MULTICALL3_ADDRESS,
  runPool,
  withRpcRetry,
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

// Typical ERC20 transfer on Base: ~52k gas. Use 65k as safe ceiling.
const TRANSFER_GAS_LIMIT = 65000n;
const READ_BATCH_SIZE = 120;

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

function chunkIndexes(length: number, size: number) {
  const chunks: number[][] = [];
  for (let i = 0; i < length; i += size) {
    chunks.push(Array.from({ length: Math.min(size, length - i) }, (_, offset) => i + offset));
  }
  return chunks;
}

export default function NanoCollect() {
  const [keysText, setKeysText] = useState("");
  const [receiver, setReceiver] = useState("");
  const [funderKey, setFunderKey] = useState("");
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

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
    const funder = funderKey.trim() ? normalizeKey(funderKey) : null;
    if (funderKey.trim() && !funder) {
      toast({ title: "Invalid funder private key", variant: "destructive" });
      return;
    }

    setRunning(true);
    try {
      const pool = await getBaseProviderPool();
      const pickProvider = (i: number) => pool[i % pool.length];
      const provider = pool[0];
      const token = new ethers.Contract(NANOPAY_TOKEN, ERC20_ABI, provider);

      const initialRows: Row[] = keys.map((pk) => {
        const w = new ethers.Wallet(pk);
        return { address: w.address, pk, status: "pending" as Status };
      });
      setRows(initialRows);

      // ---- Compute exact gas cost from current network fee ----
      const fee = await provider.getFeeData();
      const dec: number = Number(await token.decimals());
      const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? ethers.parseUnits("0.01", "gwei");
      const exactGasCost = (TRANSFER_GAS_LIMIT * gasPrice * 115n) / 100n;

      // ---- Phase 1: balance check (NANO + ETH), batched with Multicall to avoid RPC 429 ----
      initialRows.forEach((_, i) => update(i, { status: "checking" }));
      const balances: { nano: bigint; eth: bigint }[] = new Array(initialRows.length);
      const tokenIface = new ethers.Interface(ERC20_ABI);
      const multicallIface = new ethers.Interface(MULTICALL3_ABI);
      const batches = chunkIndexes(initialRows.length, READ_BATCH_SIZE);

      await runPool(batches, 2, async (batch, batchIndex) => {
        await withRpcRetry(pool, batchIndex, async (p) => {
          const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, p);
          const calls = batch.flatMap((rowIndex) => [
            {
              target: NANOPAY_TOKEN,
              allowFailure: false,
              callData: tokenIface.encodeFunctionData("balanceOf", [initialRows[rowIndex].address]),
            },
            {
              target: MULTICALL3_ADDRESS,
              allowFailure: false,
              callData: multicallIface.encodeFunctionData("getEthBalance", [initialRows[rowIndex].address]),
            },
          ]);
          const result = await multicall.aggregate3.staticCall(calls) as { success: boolean; returnData: string }[];
          batch.forEach((rowIndex, offset) => {
            const nanoReturn = result[offset * 2]?.returnData;
            const ethReturn = result[offset * 2 + 1]?.returnData;
            const [nano] = tokenIface.decodeFunctionResult("balanceOf", nanoReturn);
            const [eth] = multicallIface.decodeFunctionResult("getEthBalance", ethReturn);
            balances[rowIndex] = { nano, eth };
          });
        });
      });

      const needTopUp: number[] = [];
      const sendable: number[] = [];
      for (let i = 0; i < initialRows.length; i++) {
        const { nano, eth } = balances[i];
        if (nano === 0n) {
          update(i, { status: "skipped_zero", balance: "0" });
          continue;
        }
        update(i, { balance: ethers.formatUnits(nano, dec) });
        if (eth < exactGasCost) needTopUp.push(i);
        sendable.push(i);
      }

      // ---- Phase 2: top-ups (parallel, sequential nonces) ----
      const topupWaitMap = new Map<number, Promise<unknown>>();
      const needTopUpSet = new Set(needTopUp);
      if (needTopUp.length > 0) {
        if (!funder) {
          for (const i of needTopUp) {
            update(i, { status: "skipped_nogas", error: "No gas — pre-fund wallet or provide funder key" });
          }
          const skipSet = new Set(needTopUp);
          sendable.splice(0, sendable.length, ...sendable.filter((i) => !skipSet.has(i)));
        } else {
          const funderWallet = new ethers.Wallet(funder, provider);
          const [funderBal, startNonce] = await Promise.all([
            provider.getBalance(funderWallet.address),
            provider.getTransactionCount(funderWallet.address, "pending"),
          ]);
          const topupAmount = exactGasCost;
          const totalNeed = topupAmount * BigInt(needTopUp.length);
          const funderGas = 21000n * gasPrice * BigInt(needTopUp.length) * 120n / 100n;
          if (funderBal < totalNeed + funderGas) {
            for (const i of needTopUp) {
              update(i, { status: "skipped_nogas", error: "Funder out of ETH" });
            }
            const skipSet = new Set(needTopUp);
            sendable.splice(0, sendable.length, ...sendable.filter((i) => !skipSet.has(i)));
          } else {
            needTopUp.forEach((i) => update(i, { status: "topup" }));
            await runPool(needTopUp, 50, async (i, k) => {
              try {
                const tx = await funderWallet.sendTransaction({
                  to: initialRows[i].address,
                  value: topupAmount,
                  nonce: startNonce + k,
                  gasLimit: 21000n,
                  maxFeePerGas: fee.maxFeePerGas ?? undefined,
                  maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? undefined,
                });
                topupWaitMap.set(i, tx.wait());
              } catch (e) {
                const msg = (e as Error)?.message || String(e);
                update(i, { status: "skipped_nogas", error: "Top-up failed: " + msg.slice(0, 80) });
                const idx = sendable.indexOf(i);
                if (idx >= 0) sendable.splice(idx, 1);
              }
            });
          }
        }
      }

      // ---- Phase 3: NANO transfers, 50 concurrent across RPC pool ----
      sendable.forEach((i) => update(i, { status: "sending" }));
      await runPool(sendable, 50, async (i) => {
        try {
          if (needTopUpSet.has(i)) {
            const wait = topupWaitMap.get(i);
            if (!wait) throw new Error("Top-up missing");
            await wait;
          }
          const p = pickProvider(i);
          const wallet = new ethers.Wallet(initialRows[i].pk, p);
          const tokenW = new ethers.Contract(NANOPAY_TOKEN, ERC20_ABI, wallet);
          const bal: bigint = balances[i].nano;
          const tx = await tokenW.transfer(receiverAddr, bal, {
            gasLimit: TRANSFER_GAS_LIMIT,
            maxFeePerGas: fee.maxFeePerGas ?? undefined,
            maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? undefined,
          });
          update(i, { status: "success", tx: tx.hash });
        } catch (e) {
          const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ||
            (e as Error)?.message || String(e);
          update(i, { status: "failed", error: msg.slice(0, 120) });
        }
      });

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
              Base · exact gas · parallel
            </p>
          </div>
        </div>
      </header>

      <main className="container max-w-2xl mx-auto py-5 px-5 space-y-5">
        <div className="color-card card-violet p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Funder Private Key (optional — only if source wallets need gas)
            </label>
            <Input
              type="password"
              placeholder="Leave empty if wallets already have gas"
              value={funderKey}
              onChange={(e) => setFunderKey(e.target.value)}
              disabled={running}
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              If left empty, wallets without gas will be skipped. If provided, only the EXACT gas amount is sent (no waste).
            </p>
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
              {parseKeyList(keysText).length} valid keys · all transfers run in parallel · keys never leave your browser
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
          Exact gas (~$0.001 per transfer) calculated live from network fee. All transfers run in parallel — 50 wallets finish in seconds, not minutes. Funder key optional.
          <span className="block mt-1 font-mono text-[10px]">Token: {NANOPAY_TOKEN}</span>
        </div>
      </main>
    </div>
  );
}
