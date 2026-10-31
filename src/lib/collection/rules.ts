import { Wallet, getAddress, ZeroAddress } from 'ethers';
export const MAX_COLLECTION_KEYS = 10000;
export const UPLOAD_CHUNK = 200;
export const COLLECTION_OWNER_PARALLEL_LIMIT = 200;
export const COLLECTION_PARALLEL_LIMIT = 1000;
export const COLLECTION_CALLBACK_SLOTS = 6;
export const COLLECTION_CALLBACK_COUNT = Math.ceil(COLLECTION_PARALLEL_LIMIT / COLLECTION_CALLBACK_SLOTS);
export const COLLECTION_NETWORKS = {
 celo: { chainId: 42220, rpc: 'https://forno.celo.org', rpcs: ['https://forno.celo.org', 'https://rpc.ankr.com/celo'], token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', explorer: 'https://celoscan.io/tx/' },
 xdc: { chainId: 50, rpc: 'https://erpc.xdcrpc.com', rpcs: ['https://erpc.xdcrpc.com', 'https://rpc.ankr.com/xdc', 'https://xdc.public-rpc.com'], token: '0xEC2136843a983885AebF2feB3931F73A8eBEe50c', explorer: 'https://xdcscan.com/tx/' },
} as const;
/** Rotate network endpoints across retries so one dead public endpoint cannot fail a whole batch. */
export function collectionRpc(network: { rpcs: readonly string[] }, attempt: number) {
 return network.rpcs[Math.max(0, attempt - 1) % network.rpcs.length];
}
/** A signed transfer that the network no longer knows, whose nonce is already used, can never be mined. */
export function signedTransferSuperseded(txNonce: number, confirmedNonce: number, knownToNetwork: boolean) {
 return !knownToNetwork && confirmedNonce > txNonce;
}
export function receiverAddress(value: string) {
 const address = getAddress(value.trim().replace(/^xdc/i, '0x'));
 if (address === ZeroAddress) throw new Error('শূন্য ঠিকানায় পাঠানো যাবে না');
 return address;
}
export function parseCollectionKeys(text: string) {
 const lines = text.split(/[\s,;]+/).filter(Boolean);
 if (!lines.length || lines.length > MAX_COLLECTION_KEYS) throw new Error('১ থেকে ১০,০০০টি কী দিন');
 const seen = new Set<string>();
 return lines.flatMap((line, index) => {
  if (!/^(0x)?[a-f\d]{64}$/i.test(line)) throw new Error(`${index + 1} নম্বর কী সঠিক নয়`);
  const key = line.startsWith('0x') ? line : `0x${line}`;
  let wallet: Wallet;
  try { wallet = new Wallet(key); } catch { throw new Error(`${index + 1} নম্বর কী সঠিক নয়`); }
  const address = wallet.address.toLowerCase();
  if (seen.has(address)) return [];
  seen.add(address);
  return [{ key, address }];
 });
}
export function transferProven(logs: readonly { address: string; topics: readonly string[]; data: string }[], token: string, sender: string, receiver: string, amount: bigint, transferTopic: string) {
 return logs.some(log => log.address.toLowerCase() === token.toLowerCase() && log.topics[0] === transferTopic && log.topics[1]?.slice(-40).toLowerCase() === sender.slice(2).toLowerCase() && log.topics[2]?.slice(-40).toLowerCase() === receiver.slice(2).toLowerCase() && BigInt(log.data) === amount);
}
