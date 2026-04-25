import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  Info,
  Loader2,
  PiggyBank,
  Shield,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useWallet } from "@/hooks/useWallet";
import appLogo from "@/assets/logo.png";

// ─────────────────────────────────────────────────────────────────────────────
// Aave V3 on Celo Mainnet (verified on CeloScan)
// Pool:  https://celoscan.io/address/0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402
// ─────────────────────────────────────────────────────────────────────────────
const AAVE_POOL = "0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402";

type AssetKey = "USDT" | "USDC";

type AssetMeta = {
  symbol: AssetKey;
  underlying: string; // ERC-20 reserve token
  decimals: number;
  // Optional known aToken (used as fallback if on-chain lookup fails)
  knownAToken?: string;
  description: string;
};

const ASSETS: Record<AssetKey, AssetMeta> = {
  USDT: {
    symbol: "USDT",
    underlying: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", // USD₮ on Celo
    decimals: 6,
    knownAToken: "0xDeE98402A302e4D707fB9bf2bac66fAEEc31e8Df", // aCelUSDT
    description: "Tether USD on Celo — same token used by Buy IP payments",
  },
  USDC: {
    symbol: "USDC",
    underlying: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", // USDC on Celo
    decimals: 6,
    description: "Native Circle USDC on Celo",
  },
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Aave V3 Pool — supply + withdraw + reserve data
// Returns ReserveDataLegacy (works on Celo deployment).
const POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function getReserveData(address asset) view returns (uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)",
];

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000n;

// Convert Aave liquidity rate (ray, per second compounded) → APY %
function rayRateToAPY(ratePerSecondRay: bigint): number {
  // Aave docs: APY = ((1 + rate / SECONDS_PER_YEAR) ^ SECONDS_PER_YEAR) - 1
  // Approximation good enough for display: APR = rate / RAY, APY ≈ e^APR - 1
  const apr = Number(ratePerSecondRay) / Number(RAY) * Number(SECONDS_PER_YEAR);
  const apy = Math.expm1(apr); // e^apr - 1
  return apy * 100;
}

type AssetView = {
  meta: AssetMeta;
  aToken: string;
  apy: number;
  walletBal: string; // formatted
  walletBalRaw: bigint;
  supplyBal: string; // formatted (aToken balance — auto-rebases with interest)
  supplyBalRaw: bigint;
  allowanceRaw: bigint;
};

export default function Savings() {
  const wallet = useWallet();
  const [activeAsset, setActiveAsset] = useState<AssetKey>("USDT");
  const [view, setView] = useState<Record<AssetKey, AssetView | null>>({
    USDT: null,
    USDC: null,
  });
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [busy, setBusy] = useState<"approving" | "depositing" | "withdrawing" | null>(null);

  const provider = useMemo(() => {
    if (typeof window === "undefined" || !window.ethereum) return null;
    return new BrowserProvider(window.ethereum);
  }, [wallet.address, wallet.chainOk]);

  const refresh = useCallback(async () => {
    if (!provider || !wallet.address || !wallet.chainOk) return;
    setLoading(true);
    try {
      const pool = new Contract(AAVE_POOL, POOL_ABI, provider);
      const next: Record<AssetKey, AssetView | null> = { USDT: null, USDC: null };

      for (const key of Object.keys(ASSETS) as AssetKey[]) {
        const meta = ASSETS[key];
        try {
          const reserve: any = await pool.getReserveData(meta.underlying);
          const aToken: string =
            reserve.aTokenAddress && reserve.aTokenAddress !== "0x0000000000000000000000000000000000000000"
              ? reserve.aTokenAddress
              : meta.knownAToken ?? "";
          if (!aToken) {
            next[key] = null;
            continue;
          }
          const apy = rayRateToAPY(BigInt(reserve.currentLiquidityRate));

          const erc20 = new Contract(meta.underlying, ERC20_ABI, provider);
          const aErc20 = new Contract(aToken, ERC20_ABI, provider);
          const [walletBalRaw, supplyBalRaw, allowanceRaw] = await Promise.all([
            erc20.balanceOf(wallet.address),
            aErc20.balanceOf(wallet.address),
            erc20.allowance(wallet.address, AAVE_POOL),
          ]);
          next[key] = {
            meta,
            aToken,
            apy,
            walletBalRaw,
            walletBal: formatUnits(walletBalRaw, meta.decimals),
            supplyBalRaw,
            supplyBal: formatUnits(supplyBalRaw, meta.decimals),
            allowanceRaw,
          };
        } catch (e) {
          console.warn(`[savings] failed to load ${key}`, e);
          next[key] = null;
        }
      }
      setView(next);
    } finally {
      setLoading(false);
    }
  }, [provider, wallet.address, wallet.chainOk]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = view[activeAsset];

  const handleDeposit = async () => {
    if (!current || !provider || !wallet.address) return;
    if (!wallet.chainOk) {
      toast.error("Switch to Celo network first");
      return;
    }
    const amt = amount.trim();
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    let amtRaw: bigint;
    try {
      amtRaw = parseUnits(amt, current.meta.decimals);
    } catch {
      toast.error("Invalid amount");
      return;
    }
    if (amtRaw > current.walletBalRaw) {
      toast.error(`You only have ${current.walletBal} ${current.meta.symbol}`);
      return;
    }

    try {
      const signer = await provider.getSigner();
      // 1) Approve if needed
      if (current.allowanceRaw < amtRaw) {
        setBusy("approving");
        toast.info(`Approving ${current.meta.symbol}…`);
        const erc20 = new Contract(current.meta.underlying, ERC20_ABI, signer);
        const tx = await erc20.approve(AAVE_POOL, amtRaw);
        await tx.wait();
        toast.success("Approved ✅");
      }
      // 2) Supply
      setBusy("depositing");
      toast.info(`Depositing ${amt} ${current.meta.symbol}…`);
      const pool = new Contract(AAVE_POOL, POOL_ABI, signer);
      const tx = await pool.supply(current.meta.underlying, amtRaw, wallet.address, 0);
      const receipt = await tx.wait();
      toast.success(`Deposited! ${current.meta.symbol} now earning interest 🎉`, {
        description: `Tx: ${receipt?.hash?.slice(0, 10)}…`,
        action: receipt?.hash
          ? { label: "View", onClick: () => window.open(`https://celoscan.io/tx/${receipt.hash}`, "_blank") }
          : undefined,
      });
      setAmount("");
      await refresh();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.shortMessage || e?.reason || e?.message || "Deposit failed");
    } finally {
      setBusy(null);
    }
  };

  const handleWithdraw = async () => {
    if (!current || !provider || !wallet.address) return;
    if (!wallet.chainOk) {
      toast.error("Switch to Celo network first");
      return;
    }
    const amt = amount.trim();
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    // "max" sentinel for full withdraw
    let amtRaw: bigint;
    const isMax = Number(amt) >= Number(current.supplyBal);
    try {
      amtRaw = isMax
        ? (1n << 256n) - 1n // uint256 max → withdraw all
        : parseUnits(amt, current.meta.decimals);
    } catch {
      toast.error("Invalid amount");
      return;
    }
    if (!isMax && amtRaw > current.supplyBalRaw) {
      toast.error(`You only have ${current.supplyBal} ${current.meta.symbol} deposited`);
      return;
    }

    try {
      setBusy("withdrawing");
      const signer = await provider.getSigner();
      const pool = new Contract(AAVE_POOL, POOL_ABI, signer);
      toast.info(`Withdrawing ${current.meta.symbol}…`);
      const tx = await pool.withdraw(current.meta.underlying, amtRaw, wallet.address);
      const receipt = await tx.wait();
      toast.success(`Withdrew ${current.meta.symbol} 🎉`, {
        description: `Tx: ${receipt?.hash?.slice(0, 10)}…`,
        action: receipt?.hash
          ? { label: "View", onClick: () => window.open(`https://celoscan.io/tx/${receipt.hash}`, "_blank") }
          : undefined,
      });
      setAmount("");
      await refresh();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.shortMessage || e?.reason || e?.message || "Withdraw failed");
    } finally {
      setBusy(null);
    }
  };

  const setMax = () => {
    if (!current) return;
    if (tab === "deposit") setAmount(current.walletBal);
    else setAmount(current.supplyBal);
  };

  const totalEarning = useMemo(() => {
    let sum = 0;
    for (const k of Object.keys(view) as AssetKey[]) {
      const v = view[k];
      if (v) sum += Number(v.supplyBal);
    }
    return sum;
  }, [view]);

  return (
    <div className="aurora-bg min-h-screen bg-background relative">
      <header className="border-b border-border/30 bg-card/95 sticky top-0 z-10 backdrop-blur-xl">
        <div className="container max-w-lg mx-auto py-3.5 px-5 flex items-center gap-3">
          <Link to="/" className="p-2 -ml-2 rounded-xl hover:bg-primary/10 transition-colors">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Link>
          <img src={appLogo} alt="Celo Gas Sponsor by Good-App" className="h-9 w-9 rounded-xl shadow-md" width={36} height={36} />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-extrabold tracking-tight heading-shimmer flex items-center gap-1.5">
              In-App Savings
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </h1>
            <p className="text-[11px] text-muted-foreground font-medium">
              Earn yield on Celo · powered by Aave V3
            </p>
          </div>
          {wallet.address ? (
            <Button variant="outline" size="sm" className="gap-2 shrink-0">
              <Wallet className="h-4 w-4" />
              <span className="font-mono text-[11px]">
                {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}
              </span>
            </Button>
          ) : (
            <Button
              size="sm"
              className="btn-premium text-primary-foreground gap-2 shrink-0"
              disabled={wallet.connecting}
              onClick={() => wallet.connect().catch((e) => toast.error(e?.message || "Connect failed"))}
            >
              <Wallet className="h-4 w-4" />
              {wallet.connecting ? "…" : "Connect"}
            </Button>
          )}
        </div>
      </header>

      <main className="container max-w-lg mx-auto py-5 px-5 space-y-5 relative z-10">
        {/* Hero card */}
        <div className="color-card card-emerald shimmer-sheen p-5 animate-fade-in">
          <div className="flex items-start gap-3">
            <div className="icon-chip icon-emerald h-12 w-12 rounded-2xl float-slow">
              <PiggyBank className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/70">
                Total Earning
              </p>
              <p className="text-3xl font-extrabold heading-shimmer leading-tight">
                ${totalEarning.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Non-custodial · keys stay in your wallet · withdraw anytime
              </p>
            </div>
          </div>
        </div>

        {!wallet.hasProvider && (
          <Card className="p-4 border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              No wallet detected. Open this page in MetaMask, Trust Wallet, or Valora browser.
            </p>
          </Card>
        )}

        {wallet.address && !wallet.chainOk && (
          <Card className="p-4 border-amber-500/30 bg-amber-500/5 flex items-center justify-between gap-3">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Wallet is not on Celo network.
            </p>
            <Button size="sm" variant="outline" onClick={() => wallet.switchToCelo()}>
              Switch to Celo
            </Button>
          </Card>
        )}

        {/* Asset selector */}
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(ASSETS) as AssetKey[]).map((key) => {
            const v = view[key];
            const active = activeAsset === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setActiveAsset(key);
                  setAmount("");
                }}
                className={`color-card ${
                  key === "USDT" ? "card-emerald" : "card-cyan"
                } p-4 text-left transition-all ${
                  active ? "ring-2 ring-primary scale-[1.02]" : "opacity-80 hover:opacity-100"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-extrabold text-foreground">{key}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full premium-gradient text-primary-foreground">
                    {v ? `${v.apy.toFixed(2)}% APY` : "—"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Deposited:{" "}
                  <b className="text-foreground">
                    {v ? Number(v.supplyBal).toFixed(4) : "—"}
                  </b>
                </p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Wallet:{" "}
                  <b className="text-foreground">
                    {v ? Number(v.walletBal).toFixed(4) : "—"}
                  </b>
                </p>
              </button>
            );
          })}
        </div>

        {/* Action card */}
        <Card className="p-5 space-y-4 border-primary/20 premium-shadow">
          <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setAmount(""); }}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="deposit" className="gap-2">
                <ArrowDownToLine className="h-4 w-4" /> Deposit
              </TabsTrigger>
              <TabsTrigger value="withdraw" className="gap-2">
                <ArrowUpFromLine className="h-4 w-4" /> Withdraw
              </TabsTrigger>
            </TabsList>

            <TabsContent value="deposit" className="space-y-3 mt-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="dep-amt" className="text-xs text-muted-foreground">
                    Amount ({activeAsset})
                  </Label>
                  <button
                    type="button"
                    onClick={setMax}
                    className="text-[11px] font-bold text-primary hover:underline"
                  >
                    Max: {current ? Number(current.walletBal).toFixed(4) : "0"}
                  </button>
                </div>
                <Input
                  id="dep-amt"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                  className="h-12 text-lg font-bold"
                />
              </div>
              <Button
                onClick={handleDeposit}
                disabled={!wallet.address || !current || !!busy || loading}
                className="w-full h-11 btn-premium text-primary-foreground font-bold gap-2"
              >
                {busy === "approving" && <><Loader2 className="h-4 w-4 animate-spin" /> Approving…</>}
                {busy === "depositing" && <><Loader2 className="h-4 w-4 animate-spin" /> Depositing…</>}
                {!busy && !wallet.address && "Connect wallet to deposit"}
                {!busy && wallet.address && current && current.allowanceRaw < (amount && !isNaN(Number(amount)) ? parseUnits(amount || "0", current.meta.decimals) : 0n)
                  ? `Approve & Deposit ${activeAsset}`
                  : !busy && wallet.address && `Deposit ${activeAsset}`}
              </Button>
              <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3 w-3 shrink-0 mt-0.5" />
                First deposit needs an approval tx. After that, deposits are 1 click.
              </p>
            </TabsContent>

            <TabsContent value="withdraw" className="space-y-3 mt-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="wd-amt" className="text-xs text-muted-foreground">
                    Amount ({activeAsset})
                  </Label>
                  <button
                    type="button"
                    onClick={setMax}
                    className="text-[11px] font-bold text-primary hover:underline"
                  >
                    Max: {current ? Number(current.supplyBal).toFixed(4) : "0"}
                  </button>
                </div>
                <Input
                  id="wd-amt"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                  className="h-12 text-lg font-bold"
                />
              </div>
              <Button
                onClick={handleWithdraw}
                disabled={!wallet.address || !current || !!busy || loading}
                className="w-full h-11 font-bold gap-2"
                variant="outline"
              >
                {busy === "withdrawing" ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Withdrawing…</>
                ) : (
                  <>Withdraw {activeAsset}</>
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3 w-3 shrink-0 mt-0.5" />
                Withdraw your principal + earned interest anytime, no lock-up.
              </p>
            </TabsContent>
          </Tabs>
        </Card>

        {/* Trust footer */}
        <div className="grid grid-cols-3 gap-2">
          <div className="color-card card-violet p-3 text-center">
            <Shield className="h-4 w-4 text-foreground/70 mx-auto mb-1" />
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Custody</p>
            <p className="text-xs font-extrabold text-foreground">Yours</p>
          </div>
          <div className="color-card card-amber p-3 text-center">
            <TrendingUp className="h-4 w-4 text-foreground/70 mx-auto mb-1" />
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Protocol</p>
            <p className="text-xs font-extrabold text-foreground">Aave V3</p>
          </div>
          <div className="color-card card-emerald p-3 text-center">
            <PiggyBank className="h-4 w-4 text-foreground/70 mx-auto mb-1" />
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Withdraw</p>
            <p className="text-xs font-extrabold text-foreground">Anytime</p>
          </div>
        </div>

        <a
          href={`https://celoscan.io/address/${AAVE_POOL}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary inline-flex items-center gap-1 justify-center w-full"
        >
          Verify Aave V3 Pool on CeloScan <ExternalLink className="h-3 w-3" />
        </a>

        <Card className="p-4 border-border/40 bg-muted/20">
          <p className="text-[11px] text-foreground/75 leading-relaxed">
            <strong className="text-foreground">How it works:</strong> When you deposit, your tokens go directly to
            Aave V3's audited smart contract on Celo — not to us. You receive aTokens that auto-grow with interest.
            Withdraw any time to get principal + earned yield back. We never hold your funds.
          </p>
        </Card>

        <footer className="text-center py-4">
          <p className="text-xs text-muted-foreground">
            © 2026 Celo Gas Sponsor by Good-App · DeFi rates fluctuate · Smart-contract risk applies
          </p>
        </footer>
      </main>
    </div>
  );
}
