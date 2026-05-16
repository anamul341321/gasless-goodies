// Shared per-network config for GoodDollar batch claim feature.

export type GDNetwork = "celo" | "xdc";

export type GDNetworkConfig = {
  id: GDNetwork;
  label: string;
  chainId: number;
  rpc: string;
  identityAddress: string;
  ubiSchemeAddress: string;
  gdTokenAddress: string;
  explorerTxBase: string; // append tx hash
};

export const GD_NETWORKS: Record<GDNetwork, GDNetworkConfig> = {
  celo: {
    id: "celo",
    label: "Celo",
    chainId: 42220,
    rpc: "https://forno.celo.org",
    identityAddress: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
    ubiSchemeAddress: "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1",
    gdTokenAddress: "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A",
    explorerTxBase: "https://celoscan.io/tx/",
  },
  xdc: {
    id: "xdc",
    label: "XDC",
    chainId: 50,
    rpc: "https://erpc.xinfin.network",
    identityAddress: "0x27a4a02C9ed591E1a86e2e5D05870292c34622C9",
    ubiSchemeAddress: "0x22867567E2D80f2049200E25C6F31CB6Ec2F0faf",
    gdTokenAddress: "0xEC2136843a983885AebF2feB3931F73A8eBEe50c",
    explorerTxBase: "https://xdcscan.com/tx/",
  },
};

export function resolveNetwork(input: unknown): GDNetworkConfig {
  const v = typeof input === "string" ? input.toLowerCase().trim() : "";
  if (v === "xdc") return GD_NETWORKS.xdc;
  return GD_NETWORKS.celo;
}
