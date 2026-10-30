import { describe,it,expect } from 'vitest';
import { id, zeroPadValue, toBeHex, Wallet } from 'ethers';
import { COLLECTION_NETWORKS,parseCollectionKeys,receiverAddress,transferProven } from './rules';
describe('G$ collection rules',()=>{
 it('accepts more than 4,000 unique wallets without truncation',()=>{
  const keys=Array.from({length:4001},(_,i)=>toBeHex(i+1,32));
  expect(parseCollectionKeys(keys.join('\n'))).toHaveLength(4001);
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
});