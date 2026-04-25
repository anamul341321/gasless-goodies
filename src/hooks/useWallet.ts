import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "vip_user_wallet";
const CELO_CHAIN_ID = "0xa4ec"; // 42220

declare global {
  interface Window {
    ethereum?: any;
  }
}

export type WalletState = {
  address: string | null;
  connecting: boolean;
  chainOk: boolean;
  hasProvider: boolean;
};

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    connecting: false,
    chainOk: false,
    hasProvider: false,
  });

  useEffect(() => {
    const hasProvider = typeof window !== "undefined" && !!window.ethereum;
    const saved = localStorage.getItem(STORAGE_KEY);
    setState((s) => ({
      ...s,
      hasProvider,
      address: saved && /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved : null,
    }));

    if (hasProvider && saved) {
      window.ethereum
        .request({ method: "eth_chainId" })
        .then((id: string) => setState((s) => ({ ...s, chainOk: id === CELO_CHAIN_ID })))
        .catch(() => {});
    }

    const onAccounts = (accs: string[]) => {
      if (!accs?.length) {
        localStorage.removeItem(STORAGE_KEY);
        setState((s) => ({ ...s, address: null }));
      } else {
        localStorage.setItem(STORAGE_KEY, accs[0]);
        setState((s) => ({ ...s, address: accs[0] }));
      }
    };
    const onChain = (id: string) =>
      setState((s) => ({ ...s, chainOk: id === CELO_CHAIN_ID }));

    if (hasProvider) {
      window.ethereum.on?.("accountsChanged", onAccounts);
      window.ethereum.on?.("chainChanged", onChain);
    }
    return () => {
      if (hasProvider) {
        window.ethereum.removeListener?.("accountsChanged", onAccounts);
        window.ethereum.removeListener?.("chainChanged", onChain);
      }
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      throw new Error(
        "No wallet detected. Install MetaMask, Trust Wallet, or open this page in your wallet's browser.",
      );
    }
    setState((s) => ({ ...s, connecting: true }));
    try {
      const accs: string[] = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      if (!accs?.length) throw new Error("No account selected");
      localStorage.setItem(STORAGE_KEY, accs[0]);
      const id: string = await window.ethereum.request({ method: "eth_chainId" });
      setState({
        address: accs[0],
        connecting: false,
        chainOk: id === CELO_CHAIN_ID,
        hasProvider: true,
      });
      return accs[0];
    } catch (e) {
      setState((s) => ({ ...s, connecting: false }));
      throw e;
    }
  }, []);

  const switchToCelo = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CELO_CHAIN_ID }],
      });
    } catch (err: any) {
      if (err?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CELO_CHAIN_ID,
              chainName: "Celo Mainnet",
              nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
              rpcUrls: ["https://forno.celo.org"],
              blockExplorerUrls: ["https://celoscan.io"],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState((s) => ({ ...s, address: null }));
  }, []);

  return { ...state, connect, disconnect, switchToCelo };
}
