import { ethers } from "ethers";

export const BASE_CHAIN_ID = 8453;
export const NANOPAY_TOKEN = "0x1a5f7931E5D450C666fD8706300b984Fc4aeAba3";

export const BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://1rpc.io/base",
  "https://base.drpc.org",
  "https://base-rpc.publicnode.com",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 value) returns (bool)",
];

export async function getBaseProvider(): Promise<ethers.JsonRpcProvider> {
  let lastErr: unknown = null;
  for (const url of BASE_RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, BASE_CHAIN_ID, { staticNetwork: true });
      await p.getBlockNumber();
      return p;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`All Base RPCs unavailable: ${(lastErr as Error)?.message || lastErr}`);
}

export function normalizeKey(raw: string): string | null {
  let k = raw.trim();
  if (!k) return null;
  if (k.startsWith("0X")) k = "0x" + k.slice(2);
  if (/^[a-fA-F0-9]{64}$/.test(k)) k = "0x" + k;
  if (!/^0x[a-fA-F0-9]{64}$/.test(k)) return null;
  return k;
}

export function parseKeyList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/[\s,;]+/)) {
    const k = normalizeKey(line);
    if (!k) continue;
    if (seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

export function parseAddressList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/[\s,;]+/)) {
    const s = line.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    try {
      out.push(ethers.getAddress(s));
    } catch {
      /* skip */
    }
  }
  return out;
}
