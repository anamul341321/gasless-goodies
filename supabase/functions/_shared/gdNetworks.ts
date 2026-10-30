// Shared per-network config for GoodDollar batch claim feature.

export type GDNetwork = "celo" | "xdc" | "fuse";

export type GDNetworkConfig = {
  id: GDNetwork;
  label: string;
  chainId: number;
  rpc: string;
  /** Fallback RPC list (first entry is the primary `rpc`). */
  rpcs: string[];
  identityAddress: string;

  ubiSchemeAddress: string;
  gdTokenAddress: string;
  explorerTxBase: string; // append tx hash
  /** G$ token decimals (Fuse G$ uses 2, others 18). */
  gdDecimals: number;
};

export const GD_NETWORKS: Record<GDNetwork, GDNetworkConfig> = {
  celo: {
    id: "celo",
    label: "Celo",
    chainId: 42220,
    rpc: "https://forno.celo.org",
    rpcs: [
      "https://forno.celo.org",
      "https://rpc.ankr.com/celo",
      "https://celo.drpc.org",
      "https://1rpc.io/celo",
    ],

    identityAddress: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
    ubiSchemeAddress: "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1",
    gdTokenAddress: "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A",
    explorerTxBase: "https://celoscan.io/tx/",
    gdDecimals: 18,
  },
  xdc: {
    id: "xdc",
    label: "XDC",
    chainId: 50,
    rpc: "https://erpc.xinfin.network",
    rpcs: [
      "https://erpc.xinfin.network",
      "https://rpc.xinfin.network",
      "https://rpc1.xinfin.network",
    ],

    identityAddress: "0x27a4a02C9ed591E1a86e2e5D05870292c34622C9",
    ubiSchemeAddress: "0x22867567E2D80f2049200E25C6F31CB6Ec2F0faf",
    gdTokenAddress: "0xEC2136843a983885AebF2feB3931F73A8eBEe50c",
    explorerTxBase: "https://xdcscan.com/tx/",
    gdDecimals: 18,
  },
  fuse: {
    id: "fuse",
    label: "Fuse",
    chainId: 122,
    rpc: "https://rpc.fuse.io",
    rpcs: ["https://rpc.fuse.io", "https://fuse.drpc.org"],

    identityAddress: "0x2F9C28de9e6d44b71B91b8BA337A5D82e308E7BE",
    ubiSchemeAddress: "0xd253A5203817225e9768C05E5996d642fb96bA86",
    gdTokenAddress: "0x495d133B938596C9984d462F007B676bDc57eCEC",
    explorerTxBase: "https://explorer.fuse.io/tx/",
    gdDecimals: 2,
  },
};

export function resolveNetwork(input: unknown): GDNetworkConfig {
  const v = typeof input === "string" ? input.toLowerCase().trim() : "";
  if (v === "xdc") return GD_NETWORKS.xdc;
  if (v === "fuse") return GD_NETWORKS.fuse;
  return GD_NETWORKS.celo;
}
