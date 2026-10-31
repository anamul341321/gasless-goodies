import { Contract, FetchRequest, JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { CELO_CHAIN_ID, CELO_DISPERSE, CELO_DISPERSE_ABI, CELO_SEND_CHUNK, celoAmount, celoRecipients } from './rules';

export function celoProvider(attempt = 0) {
 const urls = ['https://forno.celo.org','https://rpc.ankr.com/celo'];
 const request = new FetchRequest(urls[attempt % urls.length]);
 request.timeout = 12000;
 return new JsonRpcProvider(request,CELO_CHAIN_ID,{staticNetwork:true,batchMaxCount:1});
}
export async function estimateCeloSend(key: string, input: string[], amountInput: string) {
 const recipients = celoRecipients(input);
 const amount = celoAmount(amountInput);
 let lastError: unknown;
 for (let attempt=0;attempt<2;attempt++) {
  const provider = celoProvider(attempt);
  try {
   const wallet = new Wallet(key,provider);
   if (recipients.some(a=>a.toLowerCase()===wallet.address.toLowerCase())) throw new Error('নিজের পাঠানোর ঠিকানা প্রাপকের তালিকায় রাখা যাবে না');
   const contract = new Contract(CELO_DISPERSE,CELO_DISPERSE_ABI,wallet);
   if (await provider.getCode(CELO_DISPERSE) === '0x') throw new Error('CELO পাঠানোর সংযোগ পাওয়া যায়নি');
   const [balance,fee] = await Promise.all([provider.getBalance(wallet.address),provider.getFeeData()]);
   const gasPrice = fee.gasPrice;
   if (!gasPrice) throw new Error('গ্যাসের খরচ জানা যায়নি');
   const chunks = Array.from({length:Math.ceil(recipients.length/CELO_SEND_CHUNK)},(_,i)=>recipients.slice(i*CELO_SEND_CHUNK,(i+1)*CELO_SEND_CHUNK));
   let fees=0n;
   // Six connections per invocation, including RPC calls.
   for (let offset=0;offset<chunks.length;offset+=6) {
    const gas = await Promise.all(chunks.slice(offset,offset+6).map(async addresses => {
     const estimate: bigint = await contract.disperseEther.estimateGas(addresses,addresses.map(()=>amount),{value:amount*BigInt(addresses.length)});
     return ((estimate*120n+99n)/100n)*gasPrice*120n/100n;
    }));
    fees += gas.reduce((a,b)=>a+b,0n);
   }
   const value=amount*BigInt(recipients.length);
   return {sender:wallet.address,recipients,amount:formatEther(amount),balance:formatEther(balance),total:formatEther(value),fees:formatEther(fees),required:formatEther(value+fees),sufficient:balance>=value+fees};
  } catch(error) {
   lastError=error;
   if (String(error).includes('নিজের পাঠানোর')) throw error;
  } finally { provider.destroy(); }
 }
 const message=String(lastError);
 if (/insufficient funds/i.test(message)) throw new Error('মূল ওয়ালেটে পাঠানোর CELO ও গ্যাসের খরচ পর্যাপ্ত নয়');
 if (/execution reverted|CALL_EXCEPTION/i.test(message)) throw new Error('এক বা একাধিক ঠিকানায় CELO পাঠানো যাবে না; ঠিকানাগুলো পরীক্ষা করুন');
 throw new Error('নেটওয়ার্ক থেকে খরচ জানা যায়নি; একটু পরে চেষ্টা করুন');
}