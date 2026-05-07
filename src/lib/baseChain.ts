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

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 value) returns (bool)",
];

export const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
];

export async function getBaseProvider(): Promise<ethers.JsonRpcProvider> {
  let lastErr: unknown = null;
  for (const url of BASE_RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, BASE_CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
      await p.getBlockNumber();
      return p;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`All Base RPCs unavailable: ${(lastErr as Error)?.message || lastErr}`);
}

// Returns multiple healthy providers — used to spread load and avoid 429 rate limits.
export async function getBaseProviderPool(): Promise<ethers.JsonRpcProvider[]> {
  const results = await Promise.all(
    BASE_RPCS.map(async (url) => {
      try {
        const p = new ethers.JsonRpcProvider(url, BASE_CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
        await p.getBlockNumber();
        return p;
      } catch {
        return null;
      }
    }),
  );
  const ok = results.filter((p): p is ethers.JsonRpcProvider => p !== null);
  if (ok.length === 0) throw new Error("All Base RPCs unavailable");
  return ok;
}

// Run async tasks with bounded concurrency.
export async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function withRpcRetry<T>(
  providers: ethers.JsonRpcProvider[],
  startIndex: number,
  worker: (provider: ethers.JsonRpcProvider, attempt: number) => Promise<T>,
): Promise<T> {
  let lastErr: unknown = null;
  const attempts = Math.max(6, providers.length * 2);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const provider = providers[(startIndex + attempt) % providers.length];
    try {
      return await worker(provider, attempt);
    } catch (e) {
      lastErr = e;
      const wait = 250 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastErr;
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
