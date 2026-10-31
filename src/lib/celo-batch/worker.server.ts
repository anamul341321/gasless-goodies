import { Contract, Interface, Transaction, Wallet, keccak256 } from 'ethers';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { decryptCollectionKey } from '../collection/crypto.server';
import { CELO_CHAIN_ID, CELO_DISPERSE, CELO_DISPERSE_ABI, celoAmount, nativeBatchProven } from './rules';
import { celoProvider } from './transfer.server';

export async function processCeloWave() {
 const {data:jobs,error}=await supabaseAdmin.rpc('reserve_celo_batch');
 if(error) throw new Error('ব্যাচের কাজ নেওয়া যায়নি');
 const job=jobs?.[0];
 if(!job?.lease_id) return {processed:0};
 const {data:chunk,error:readError}=await supabaseAdmin.from('celo_batch_chunks').select('*').eq('job_id',job.id).in('status',['pending','confirming']).order('position').limit(1).maybeSingle();
 if(readError) throw new Error('ব্যাচ পড়া যায়নি');
 if(!chunk) {await supabaseAdmin.rpc('finish_celo_batch',{p_job:job.id,p_lease:job.lease_id});return {processed:0};}
 const provider=celoProvider(chunk.attempts);
 let prepared=Boolean(chunk.signed_tx);
 const write=async(patch:Record<string,unknown>)=>{
  const {data:written,error:writeError}=await supabaseAdmin.rpc('write_celo_chunk',{p_job:job.id,p_lease:job.lease_id??'',p_chunk:chunk.id,p_patch:patch as never});
  if(writeError||!written) throw new Error('কাজের অনুমতি শেষ হয়েছে');
 };
 try {
  const recipients=chunk.recipients as string[];
  const amount=celoAmount(job.amount);
  const expectedData=new Interface(CELO_DISPERSE_ABI).encodeFunctionData('disperseEther',[recipients,recipients.map(()=>amount)]);
  let raw=chunk.signed_tx;
  let hash=chunk.tx_hash;
  if(!raw) {
   if(job.status!=='running') {await write({status:'cancelled'});return {processed:1};}
   if(!job.encrypted_key) throw new Error('কী পাওয়া যায়নি');
   const signer=new Wallet(await decryptCollectionKey(job.encrypted_key),provider);
   if(signer.address.toLowerCase()!==job.sender_address.toLowerCase()) throw new Error('পাঠানোর ওয়ালেট মেলেনি');
   const contract=new Contract(CELO_DISPERSE,CELO_DISPERSE_ABI,signer);
   const value=amount*BigInt(recipients.length);
   const gas:bigint=await contract.disperseEther.estimateGas(recipients,recipients.map(()=>amount),{value});
   const [fee,nonce,balance]=await Promise.all([provider.getFeeData(),provider.getTransactionCount(signer.address,'pending'),provider.getBalance(signer.address)]);
   if(!fee.gasPrice) throw new Error('গ্যাসের খরচ জানা যায়নি');
   const gasLimit=(gas*120n+99n)/100n;
   if(balance<value+gasLimit*fee.gasPrice) throw new Error('insufficient funds');
   raw=await signer.signTransaction({to:CELO_DISPERSE,data:expectedData,value,chainId:CELO_CHAIN_ID,type:0,gasPrice:fee.gasPrice,gasLimit,nonce});
   hash=keccak256(raw);
   // Atomic lease and stop check. An uncertain write must NOT broadcast.
   await write({signed_tx:raw,tx_hash:hash,status:'confirming',error_message:null});
   prepared=true;
  }
  if(!hash||!raw) throw new Error('লেনদেন অসম্পূর্ণ');
  const signed=Transaction.from(raw);
  let receipt=await provider.getTransactionReceipt(hash);
  if(!receipt) {
   try {await provider.broadcastTransaction(raw);} catch(error) {
    const known=await provider.getTransaction(hash);
    if(!known) {
     const nonce=await provider.getTransactionCount(job.sender_address,'latest');
     receipt=await provider.getTransactionReceipt(hash);
     if(!receipt&&nonce>signed.nonce) {
      await write({status:'failed',signed_tx:null,error_message:'মূল ওয়ালেটের একই ক্রমে অন্য লেনদেন হয়েছে; এই পাঠানো আর হবে না'});
      return {processed:1};
     }
     if(!receipt) throw error;
    }
   }
   receipt=receipt??await provider.getTransactionReceipt(hash);
  }
  if(!receipt) {await write({status:'confirming',error_message:null});return {processed:1};}
  const proven=nativeBatchProven(signed,job.sender_address,expectedData,amount,recipients.length,receipt.status);
  await write({status:proven?'success':'failed',signed_tx:null,error_message:proven?null:'লেনদেন সফল হয়নি; এই ঠিকানাগুলোতে CELO পাঠানো যায়নি'});
 } catch(error) {
  const message=String(error);
  if(prepared) await write({status:'confirming',error_message:'নেটওয়ার্কের নিশ্চিত ফলাফলের অপেক্ষায়; দ্বিতীয়বার পাঠানো হচ্ছে না'});
  else {
   const terminal=/insufficient funds|CALL_EXCEPTION|execution reverted/i.test(message);
   await write({status:terminal?'failed':'pending',error_message:/insufficient funds/i.test(message)?'মূল ওয়ালেটে CELO ও গ্যাসের খরচ পর্যাপ্ত নয়':terminal?'কোনো ঠিকানা CELO গ্রহণ করেনি; লেনদেন হয়নি':'নেটওয়ার্কে সংযোগ হয়নি; আবার চেষ্টা হবে'});
  }
 } finally {
  provider.destroy();
  await supabaseAdmin.rpc('finish_celo_batch',{p_job:job.id,p_lease:job.lease_id});
 }
 return {processed:1};
}