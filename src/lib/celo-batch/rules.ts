import { getAddress, formatEther, parseEther } from 'ethers';

export const MAX_CELO_RECIPIENTS = 10000;
export const CELO_SEND_CHUNK = 75;
export const CELO_CHAIN_ID = 42220;
export const CELO_DISPERSE = '0xD152f549545093347A162Dce210e7293f1452150';
export const CELO_DISPERSE_ABI = ['function disperseEther(address[] recipients,uint256[] values) payable'];
export function celoRecipients(input: string | string[]) {
 const entries = Array.isArray(input) ? input : input.trim().split(/[\s,;]+/).filter(Boolean);
 if (!entries.length || entries.length > MAX_CELO_RECIPIENTS) throw new Error('১ থেকে ১০,০০০টি ঠিকানা দিন');
 const addresses = entries.map((entry, index) => {
  try {
   const address = getAddress(entry.trim());
   if (address === '0x0000000000000000000000000000000000000000') throw new Error();
   return address;
  } catch { throw new Error(`${index + 1} নম্বর ঠিকানাটি সঠিক নয়`); }
 });
 if (new Set(addresses.map(a => a.toLowerCase())).size !== addresses.length) throw new Error('একই ঠিকানা একাধিকবার দেওয়া হয়েছে; অতিরিক্ত পাঠানো ঠেকাতে ঠিক করুন');
 return addresses;
}
export function celoAmount(input: string) {
 if (!/^\d+(\.\d{1,18})?$/.test(input.trim())) throw new Error('সঠিক CELO পরিমাণ দিন; সর্বোচ্চ ১৮ ঘর দশমিক');
 const amount = parseEther(input.trim());
 if (amount <= 0n) throw new Error('CELO পরিমাণ শূন্যের বেশি হতে হবে');
 return amount;
}
export function celoTotal(amount: string, count: number) {
 return formatEther(celoAmount(amount) * BigInt(count));
}
export function celoFunding(amount: bigint, count: number, gasLimit: bigint, gasPrice: bigint) {
 const value = amount * BigInt(count);
 const fees = gasLimit * gasPrice * BigInt(Math.ceil(count / CELO_SEND_CHUNK));
 return { value, fees, required: value + fees };
}
export function nativeBatchProven(tx: { to: string | null; from: string | null; chainId: bigint; value: bigint; data: string }, sender: string, expectedData: string, amount: bigint, count: number, receiptStatus: number | null) {
 return receiptStatus === 1 && tx.chainId === BigInt(CELO_CHAIN_ID) && tx.to?.toLowerCase() === CELO_DISPERSE.toLowerCase() && tx.from?.toLowerCase() === sender.toLowerCase() && tx.data === expectedData && tx.value === amount * BigInt(count);
}