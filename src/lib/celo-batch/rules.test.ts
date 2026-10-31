import { describe, expect, it } from 'vitest';
import { parseEther } from 'ethers';
import { celoRecipients, celoAmount, celoTotal, celoFunding, nativeBatchProven, CELO_DISPERSE } from './rules';
describe('equal native CELO sending', () => {
 it('accepts more than 1000 recipients including 10000', () => {
  const addresses = Array.from({length:10000}, (_,i) => '0x'+(i+1).toString(16).padStart(40,'0'));
  expect(celoRecipients(addresses)).toHaveLength(10000);
  expect(() => celoRecipients([...addresses,'0x'+(10001).toString(16).padStart(40,'0')])).toThrow();
 });
 it('sends exactly 0.1 CELO to each of 1001 wallets', () => expect(celoTotal('0.1',1001)).toBe('100.1'));
 it('sends exactly 0.3 CELO to each of 1001 wallets', () => expect(celoTotal('0.3',1001)).toBe('300.3'));
 it('adds fees rather than subtracting from recipient amounts', () => {
  const funding = celoFunding(celoAmount('0.1'),1001,1000000n,1000000000n);
  expect(funding.value).toBe(parseEther('100.1'));
  expect(funding.fees).toBe(parseEther('0.014'));
  expect(funding.required).toBe(parseEther('100.114'));
 });
 it('rejects duplicate recipients and invalid input without silently dropping addresses', () => {
  const a = '0x0000000000000000000000000000000000000001';
  expect(() => celoRecipients([a,a])).toThrow();
  expect(() => celoRecipients([a,'bad'])).toThrow();
 });
 it('rejects zero, negative and precision-losing values', () => {
  for (const value of ['0','-0.1','1e-3','0.1234567890123456789']) expect(() => celoAmount(value)).toThrow();
 });
 it('never calls broadcast acknowledgement success; needs matching mined transaction', () => {
  const tx = {to:CELO_DISPERSE,from:'0x0000000000000000000000000000000000000001',chainId:42220n,value:parseEther('0.3'),data:'0x1234'};
  expect(nativeBatchProven(tx,tx.from,'0x1234',parseEther('0.1'),3,1)).toBe(true);
  expect(nativeBatchProven(tx,tx.from,'0x1234',parseEther('0.1'),3,null)).toBe(false);
  expect(nativeBatchProven(tx,tx.from,'0x1234',parseEther('0.1'),3,0)).toBe(false);
  expect(nativeBatchProven({...tx,value:parseEther('0.2')},tx.from,'0x1234',parseEther('0.1'),3,1)).toBe(false);
 });
});