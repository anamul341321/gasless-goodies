import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Phone, CheckCircle2, Clock, Loader2, Zap, TrendingUp, Wallet, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { BrowserProvider, Contract, parseUnits } from "ethers";
import appLogo from "@/assets/logo.png";

const CELO_CHAIN_ID = "0xa4ec";
const CELO_RPC = "https://forno.celo.org";
const AVAILABLE_TOKENS = ["USDT", "USDC", "CELO"];

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const OPERATORS = [
  { id: "grameenphone", name: "Grameenphone", code: "GP", logo: "/operators/gp.png" },
  { id: "robi", name: "Robi", code: "RB", logo: "/operators/rb.png" },
  { id: "banglalink", name: "Banglalink", code: "BL", logo: "/operators/bl.png" },
  { id: "airtel", name: "Airtel", code: "AT", logo: "/operators/ar.png" },
  { id: "teletalk", name: "Teletalk", code: "TT", logo: "/operators/tl.png" },
  { id: "skitto", name: "Skitto", code: "SK", logo: "/operators/sk.png" },
  { id: "brilliant", name: "Brilliant", code: "BT", logo: "/operators/bk.png" },
];

const RECHARGE_AMOUNTS = [
  { bdt: 20, label: "20 ৳" },
  { bdt: 30, label: "30 ৳" },
  { bdt: 50, label: "50 ৳" },
  { bdt: 100, label: "100 ৳" },
  { bdt: 200, label: "200 ৳" },
  { bdt: 300, label: "300 ৳" },
  { bdt: 500, label: "500 ৳" },
  { bdt: 1000, label: "1000 ৳" },
];

interface TokenInfo { symbol: string; address: string | null; decimals: number; }

export default function Recharge() {
  const [operator, setOperator] = useState("");
  const [phone, setPhone] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [instantSuccess, setInstantSuccess] = useState(false);
  const [error, setError] = useState("");
  const [payStatus, setPayStatus] = useState("");

  // Wallet
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Config
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [selectedToken, setSelectedToken] = useState("USDT");
  const [configLoading, setConfigLoading] = useState(true);
  const [serviceAvailable, setServiceAvailable] = useState(true);

  // Fetch config + check service balance
  useEffect(() => {
    const fetchConfig = async () => {
      setConfigLoading(true);
      try {
        const [configRes, balRes] = await Promise.all([
          supabase.functions.invoke("recharge-request", { body: { action: "config" } }),
          supabase.functions.invoke("recharge-request", { body: { action: "balance" } }),
        ]);
        if (configRes.data) {
          const filteredPrices = Object.fromEntries(
            Object.entries(configRes.data.prices || {}).filter(([symbol]) => AVAILABLE_TOKENS.includes(symbol))
          ) as Record<string, number>;
          const filteredTokens = (configRes.data.tokens || []).filter((token: TokenInfo) => AVAILABLE_TOKENS.includes(token.symbol));
          setDepositAddress(configRes.data.deposit_address);
          setPrices(filteredPrices);
          setTokens(filteredTokens);
        }
        const bal = balRes.data?.balance || 0;
        setServiceAvailable(bal >= 20);
      } catch {}
      setConfigLoading(false);
    };
    fetchConfig();
  }, []);

  const tokenPrice = prices[selectedToken] || 0;
  const tokenInfo = tokens.find(t => t.symbol === selectedToken);

  const calcTokenAmount = useCallback((bdt: number) => {
    if (!tokenPrice || tokenPrice <= 0) return 0;
    return bdt / tokenPrice;
  }, [tokenPrice]);

  const formatTokenAmount = (amount: number) => {
    if (amount < 0.01) return amount.toFixed(6);
    if (amount < 1) return amount.toFixed(4);
    return amount.toFixed(2);
  };

  const finalBdt = selectedAmount || (customAmount ? Number(customAmount) : 0);
  const tokenAmount = finalBdt > 0 ? calcTokenAmount(finalBdt) : 0;

  // Wallet
  const switchToCelo = async (provider: any) => {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CELO_CHAIN_ID }] });
    } catch (e: any) {
      if (e.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CELO_CHAIN_ID, chainName: "Celo Mainnet",
            nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
            rpcUrls: [CELO_RPC], blockExplorerUrls: ["https://celoscan.io"],
          }],
        });
      }
    }
  };

  const connectWallet = async () => {
    if (!(window as any).ethereum) {
      setError("No wallet detected. Install MetaMask or any Web3 wallet.");
      return;
    }
    setConnecting(true); setError("");
    try {
      const provider = (window as any).ethereum;
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      await switchToCelo(provider);
      setWalletAddress(accounts[0]);
    } catch (e: any) {
      setError(e?.message || "Failed to connect wallet");
    }
    setConnecting(false);
  };

  const disconnect = () => { setWalletAddress(null); setError(""); };

  // Payment flow
  const handlePayAndRecharge = async () => {
    if (!walletAddress || !depositAddress) {
      setError("Please connect your wallet first"); return;
    }
    if (!operator || !phone) { setError("Please select operator and enter number"); return; }
    const clean = phone.replace(/\D/g, "");
    if (!/^01[3-9]\d{8}$/.test(clean)) { setError("Enter a valid number (01XXXXXXXXX)"); return; }
    if (finalBdt < 20) { setError("Minimum amount is 20 ৳"); return; }
    if (tokenAmount <= 0) { setError("Invalid amount"); return; }

    setSubmitting(true); setError(""); setPayStatus("Checking service availability...");
    try {
      const balCheck = await supabase.functions.invoke("recharge-request", { body: { action: "balance" } });
      const apiBalance = balCheck?.data?.balance || 0;
      if (apiBalance < finalBdt) {
        setError("⚠️ Service temporarily unavailable. Please try again later or contact support.");
        setSubmitting(false); setPayStatus(""); return;
      }
      setPayStatus("Initiating payment...");
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      let txHash: string;

      if (selectedToken === "CELO") {
        setPayStatus("Sending CELO...");
        const amountWei = parseUnits(tokenAmount.toFixed(18), 18);
        const tx = await signer.sendTransaction({ to: depositAddress, value: amountWei });
        setPayStatus("Confirming transaction...");
        await tx.wait();
        txHash = tx.hash;
      } else {
        const tc = tokenInfo;
        if (!tc?.address) { setError("Token not supported"); setSubmitting(false); return; }
        setPayStatus(`Sending ${selectedToken}...`);
        const contract = new Contract(tc.address, ERC20_ABI, signer);
        const rawAmount = parseUnits(tokenAmount.toFixed(tc.decimals), tc.decimals);
        const tx = await contract.transfer(depositAddress, rawAmount);
        setPayStatus("Confirming transaction...");
        await tx.wait();
        txHash = tx.hash;
      }

      setPayStatus("Payment confirmed! Processing...");

      const requestBody: Record<string, unknown> = {
        phone_number: phone.replace(/\D/g, ""), operator,
        amount_bdt: finalBdt, amount_token: formatTokenAmount(tokenAmount),
        pay_token: selectedToken, tx_hash: txHash, wallet_address: walletAddress,
        type: "recharge",
      };

      const { data, error: fnError } = await supabase.functions.invoke("recharge-request", { body: requestBody });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setInstantSuccess(!!data?.instant);
      setSuccess(true);
    } catch (e: any) {
      if (e?.message?.includes("user rejected") || e?.message?.includes("User denied")) {
        setError("Transaction cancelled by user");
      } else {
        setError(e?.message || "Payment failed. Please try again.");
      }
    } finally {
      setSubmitting(false); setPayStatus("");
    }
  };

  const resetForm = () => {
    setSuccess(false); setInstantSuccess(false); setSelectedAmount(null);
    setCustomAmount(""); setPhone(""); setError("");
    setPayStatus("");
  };

  const OperatorGrid = ({ onSelect, selected }: { onSelect: (id: string) => void; selected: string }) => (
    <div className="grid grid-cols-4 gap-2">
      {OPERATORS.map(op => (
        <button key={op.id} onClick={() => onSelect(op.id)}
          className={`glass-card rounded-xl p-2.5 text-center transition-all duration-200 ${
            selected === op.id ? "ring-2 ring-primary border-primary/50 shadow-lg scale-105" : "hover:border-primary/30 hover:scale-[1.02]"
          }`}>
          <img src={op.logo} alt={op.name} className="h-10 w-10 mx-auto object-contain rounded-lg" />
          <p className="text-[10px] text-muted-foreground mt-1 truncate">{op.name}</p>
        </button>
      ))}
    </div>
  );

  const TokenSelector = () => (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-foreground">Payment Token</label>
      <div className="flex gap-2 flex-wrap">
        {AVAILABLE_TOKENS.map(token => (
          <button key={token} onClick={() => setSelectedToken(token)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              selectedToken === token
                ? "bg-primary text-primary-foreground shadow-md"
                : "glass-card text-foreground hover:border-primary/30"
            }`}>
            {token}
            {prices[token] ? (
              <span className="block text-[9px] font-normal opacity-80">
                1 = {prices[token] < 1 ? prices[token].toFixed(4) : prices[token].toFixed(1)} ৳
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 backdrop-blur-2xl bg-card/60 sticky top-0 z-10 shadow-sm">
        <div className="container max-w-lg mx-auto py-3 px-4 flex items-center gap-3">
          <Link to="/" className="p-2 -ml-2 rounded-xl hover:bg-muted transition-colors">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Link>
          <img src={appLogo} alt="Celo Gas Sponsor by Good-App" className="h-9 w-9 rounded-xl shadow-md" />
          <div className="flex-1">
            <h1 className="text-base font-bold text-foreground flex items-center gap-1.5">
              Mobile Recharge <Zap className="h-3.5 w-3.5 text-primary" />
            </h1>
            <p className="text-xs text-muted-foreground">Pay with crypto, instant top-up</p>
          </div>
          {walletAddress && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">{walletAddress.slice(0, 5)}...{walletAddress.slice(-3)}</span>
              <button onClick={disconnect} className="p-1.5 rounded-lg hover:bg-muted"><LogOut className="h-3.5 w-3.5 text-muted-foreground" /></button>
            </div>
          )}
        </div>
      </header>

      <main className="container max-w-lg mx-auto py-5 px-4 space-y-4">
        {/* Wallet Connection */}
        {!walletAddress && (
          <div className="glass-card rounded-2xl p-5 space-y-3 animate-fade-in border-primary/20">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold text-foreground">Connect Wallet to Pay</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Connect your Celo wallet to pay with supported tokens.
            </p>
            <Button onClick={connectWallet} disabled={connecting}
              className="w-full rounded-xl h-11 text-sm font-bold shadow-lg bg-gradient-to-r from-primary to-accent hover:opacity-90">
              {connecting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Connecting...</> : <><Wallet className="h-4 w-4 mr-2" /> Connect Wallet</>}
            </Button>
          </div>
        )}

        {/* Live Rates */}
        {!configLoading && Object.keys(prices).length > 0 && (
          <div className="glass-card rounded-2xl p-3 animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-foreground">Live Rates</span>
            </div>
            <div className="flex gap-3 flex-wrap">
              {Object.entries(prices).map(([token, price]) => (
                <span key={token} className="text-[10px] text-muted-foreground">
                  <span className="font-bold text-foreground">{token}</span> = {price < 1 ? price.toFixed(4) : price.toFixed(1)} ৳
                </span>
              ))}
            </div>
          </div>
        )}

        {success ? (
          <div className="glass-card rounded-2xl p-6 text-center space-y-4 animate-fade-in">
            <div className={`h-16 w-16 rounded-full flex items-center justify-center mx-auto ${instantSuccess ? "bg-primary/10" : "bg-primary/10"}`}>
              {instantSuccess ? <CheckCircle2 className="h-8 w-8 text-primary" /> : <Clock className="h-8 w-8 text-primary" />}
            </div>
            <h2 className="text-lg font-bold text-foreground">{instantSuccess ? "Success! 🎉" : "Payment Received!"}</h2>
            <p className="text-sm text-muted-foreground">
              {instantSuccess ? "Your transaction has been completed." : "Payment confirmed. Processing your request."}
            </p>
            <div className="flex gap-2">
              <Button onClick={resetForm} variant="outline" className="flex-1 rounded-xl">New Request</Button>
              <Link to="/" className="flex-1"><Button className="w-full rounded-xl">Home</Button></Link>
            </div>
          </div>
        ) : (
          <>
            {walletAddress && <TokenSelector />}

            <div className="space-y-4 animate-fade-in">
              <div className="glass-card rounded-2xl p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">How It Works</h3>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Connect wallet & select payment token</li>
                  <li>Choose operator, enter number, select amount</li>
                  <li>Pay with crypto — instant recharge! ⚡</li>
                </ol>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">1. Select Operator</label>
                <OperatorGrid onSelect={setOperator} selected={operator} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">2. Mobile Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="tel" placeholder="01XXXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} className="pl-10 rounded-xl" maxLength={11} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">3. Amount</label>
                <div className="grid grid-cols-4 gap-2">
                  {RECHARGE_AMOUNTS.map(amt => (
                    <button key={amt.bdt} onClick={() => { setSelectedAmount(amt.bdt); setCustomAmount(""); }}
                      className={`glass-card rounded-xl p-2 text-center transition-all ${
                        selectedAmount === amt.bdt ? "ring-2 ring-primary border-primary/50 shadow-lg" : "hover:border-primary/30"
                      }`}>
                      <p className="text-sm font-bold text-foreground">{amt.label}</p>
                      <p className="text-[9px] text-primary font-semibold">
                        ≈ {tokenPrice > 0 ? formatTokenAmount(calcTokenAmount(amt.bdt)) : "..."} {selectedToken}
                      </p>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Custom:</span>
                  <Input type="number" placeholder="Amount ৳ (min 20)" value={customAmount}
                    onChange={e => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
                    className="rounded-xl flex-1" min={20} />
                </div>
              </div>

              {finalBdt > 0 && (
                <div className="glass-card rounded-2xl p-4 space-y-2 border-primary/30 animate-fade-in">
                  <h3 className="text-sm font-bold text-foreground">Summary</h3>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Operator</span><span className="text-foreground font-medium">{OPERATORS.find(o => o.id === operator)?.name || "—"}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Number</span><span className="text-foreground font-medium">{phone || "—"}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Amount</span><span className="text-foreground font-medium">{finalBdt} ৳</span></div>
                  <div className="h-px bg-border" />
                  <div className="flex justify-between text-sm"><span className="font-semibold text-foreground">Pay</span><span className="font-bold text-primary">{formatTokenAmount(tokenAmount)} {selectedToken}</span></div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && <div className="glass-card rounded-xl p-3 border-destructive/30 bg-destructive/5 text-sm text-destructive">{error}</div>}

            {/* Pay Status */}
            {payStatus && (
              <div className="glass-card rounded-xl p-3 flex items-center gap-2 border-primary/30 bg-primary/5 animate-pulse">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-primary font-medium">{payStatus}</span>
              </div>
            )}

            {/* Pay Button */}
            {!success && (
              <Button onClick={handlePayAndRecharge}
                disabled={submitting || !walletAddress || finalBdt <= 0 || configLoading || !serviceAvailable}
                className="w-full rounded-xl h-12 text-base font-bold shadow-lg">
                {!walletAddress ? "Connect Wallet First"
                  : !serviceAvailable ? "Service temporarily unavailable"
                  : submitting ? <><Loader2 className="h-5 w-5 animate-spin mr-2" /> Processing...</>
                  : tokenAmount > 0 ? <>⚡ Pay {formatTokenAmount(tokenAmount)} {selectedToken} & Recharge</>
                  : "Select amount"}
              </Button>
            )}
          </>
        )}

        <div className="text-center text-xs text-muted-foreground pt-2">
          <p>⚡ Instant processing</p>
          <p className="mt-1">Need help? <Link to="/about" className="text-primary hover:underline">Contact us</Link></p>
        </div>
      </main>
    </div>
  );
}
