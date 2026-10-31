import { describe,it,expect } from 'vitest';
import { id, zeroPadValue, toBeHex, Wallet } from 'ethers';
import { COLLECTION_NETWORKS, COLLECTION_OWNER_PARALLEL_LIMIT, COLLECTION_PARALLEL_LIMIT, COLLECTION_CALLBACK_SLOTS, COLLECTION_CALLBACK_COUNT,parseCollectionKeys,receiverAddress,transferProven,collectionRpc,signedTransferSuperseded } from './rules';
describe('G$ collection rules',()=>{
 it('keeps per-owner capacity separate from the shared safety ceiling',()=>{
  expect(COLLECTION_OWNER_PARALLEL_LIMIT).toBe(200);
  expect(COLLECTION_PARALLEL_LIMIT).toBe(1000);
  expect(COLLECTION_CALLBACK_SLOTS).toBe(6);
  expect(COLLECTION_CALLBACK_COUNT).toBe(167);
  expect(COLLECTION_CALLBACK_COUNT*COLLECTION_CALLBACK_SLOTS).toBeGreaterThanOrEqual(1000);
  expect((COLLECTION_CALLBACK_COUNT-1)*COLLECTION_CALLBACK_SLOTS).toBeLessThan(1000);
 });
 it('accepts 10,000 unique wallets for each user without truncation',()=>{
  const keys=Array.from({length:10000},(_,i)=>toBeHex(i+1,32));
  expect(parseCollectionKeys(keys.join('\n'))).toHaveLength(10000);
 },20000);
 it('rejects a batch above 10,000 without silently dropping wallets',()=>{
  expect(()=>parseCollectionKeys(Array.from({length:10001},(_,i)=>toBeHex(i+1,32)).join('\n'))).toThrow();
 });
 it('deduplicates repeated keys to prevent duplicate transfers',()=>{const key=toBeHex(1,32);expect(parseCollectionKeys(`${key}\n${key}`)).toHaveLength(1)});
 it('supports both requested networks and their G$ token contracts',()=>{
  expect(COLLECTION_NETWORKS.celo.chainId).toBe(42220);expect(COLLECTION_NETWORKS.xdc.chainId).toBe(50);
  expect(COLLECTION_NETWORKS.xdc.token).toBe('0xEC2136843a983885AebF2feB3931F73A8eBEe50c');
 });
 it('rejects invalid and zero private keys',()=>{expect(()=>parseCollectionKeys('bad')).toThrow();expect(()=>parseCollectionKeys(toBeHex(0,32))).toThrow()});
 it('normalizes XDC receiver addresses and rejects zero receivers',()=>{const address=new Wallet(toBeHex(2,32)).address;expect(receiverAddress(address.replace('0x','xdc'))).toBe(address);expect(()=>receiverAddress(toBeHex(0,20))).toThrow()});
 it('requires actual matching G$ transfer evidence rather than successful receipt alone',()=>{
  const sender=new Wallet(toBeHex(1,32)).address;const receiver=new Wallet(toBeHex(2,32)).address;const topic=id('Transfer(address,address,uint256)');
  const log={address:COLLECTION_NETWORKS.celo.token,topics:[topic,zeroPadValue(sender,32),zeroPadValue(receiver,32)],data:toBeHex(500,32)};
  expect(transferProven([log],log.address,sender,receiver,500n,topic)).toBe(true);
  expect(transferProven([],log.address,sender,receiver,500n,topic)).toBe(false);
  expect(transferProven([log],log.address,sender,receiver,501n,topic)).toBe(false);
 });
 it('ends a stored transfer only when its nonce is used and the network does not know it',()=>{
  expect(signedTransferSuperseded(33,34,false)).toBe(true);
  expect(signedTransferSuperseded(33,33,false)).toBe(false);
  expect(signedTransferSuperseded(33,34,true)).toBe(false);
 });
 it('moves XDC retries off a failed network endpoint',()=>{
  const xdc=COLLECTION_NETWORKS.xdc;
  expect(collectionRpc(xdc,1)).toBe('https://erpc.xdcrpc.com');
  expect(collectionRpc(xdc,2)).not.toBe(collectionRpc(xdc,1));
  expect(collectionRpc(xdc,3)).not.toBe(collectionRpc(xdc,2));
 });
});
