import { Contract, Interface, JsonRpcProvider, Wallet, formatUnits, keccak256, id } from 'ethers';
import { COLLECTION_CALLBACK_SLOTS, COLLECTION_NETWORKS, transferProven } from './rules';
import { decryptCollectionKey } from './crypto.server';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
const ABI = ['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)','function transfer(address,uint256) returns(bool)'];
export async function processCollectionWave() {
 const { data: rows,error } = await supabaseAdmin.rpc('reserve_gd_collection_items',{p_limit:COLLECTION_CALLBACK_SLOTS});
 if (error) throw error;
 await Promise.all((rows ?? []).map(async row => {
  const { data: job } = await supabaseAdmin.from('gd_collection_jobs').select('network,receiver,status').eq('id',row.job_id).single();
  if (!job || !(job.network in COLLECTION_NETWORKS)) return;
  const network = COLLECTION_NETWORKS[job.network as keyof typeof COLLECTION_NETWORKS];
  const provider = new JsonRpcProvider(network.rpc, network.chainId, { staticNetwork: true, batchMaxCount: 1 });
  const update = async (patch: Record<string, unknown>) => {
   const { data: written,error: writeError } = await supabaseAdmin.from('gd_collection_items').update({...patch,updated_at:new Date().toISOString()}).eq('id',row.id).eq('lease_id',row.lease_id ?? '').select('id').maybeSingle();
   if (writeError || !written) throw new Error('Lease lost');
  };
  let prepared = !!row.signed_tx;
  try {
   let raw = row.signed_tx;
   let hash = row.tx_hash;
   let amount = row.amount;
   if (!raw) {
    if (job.status !== 'running') { await update({status:'cancelled',encrypted_key:null,lease_until:null}); return; }
    if (!row.encrypted_key) throw new Error('কী পাওয়া যায়নি');
    const signer = new Wallet(await decryptCollectionKey(row.encrypted_key),provider);
    const token = new Contract(network.token,ABI,signer);
    const balance: bigint = await token.balanceOf(signer.address);
    if (balance === 0n) { await update({status:'empty',amount:'0',encrypted_key:null,lease_until:null}); return; }
    const decimals = Number(await token.decimals());
    amount = formatUnits(balance,decimals);
    const transaction = await token.transfer.populateTransaction(job.receiver,balance);
    const populated = await signer.populateTransaction(transaction);
    raw = await signer.signTransaction(populated); hash = keccak256(raw);
    // Persist the exact signed transaction BEFORE broadcast; recovery can only rebroadcast this same hash.
    const { data: stillRunning } = await supabaseAdmin.from('gd_collection_jobs').select('status').eq('id',row.job_id).single();
    if (stillRunning?.status !== 'running') { await update({status:'cancelled',encrypted_key:null,lease_until:null}); return; }
    await update({signed_tx:raw,tx_hash:hash,amount,status:'confirming',encrypted_key:null}); prepared=true;
   }
   if (!hash || !raw || !amount) throw new Error('লেনদেনের তথ্য অসম্পূর্ণ');
   let receipt = await provider.getTransactionReceipt(hash);
   if (!receipt) {
    try { await provider.broadcastTransaction(raw); } catch (broadcastError) {
     // Receipt/known transaction is authoritative; do not create a replacement transfer.
     if (!(await provider.getTransaction(hash))) throw broadcastError;
    }
    receipt = await provider.getTransactionReceipt(hash);
   }
   if (!receipt) { await update({status:'confirming',lease_until:new Date(Date.now()+30000).toISOString()}); return; }
   const decoded = new Interface(ABI).decodeFunctionData('transfer', (await provider.getTransaction(hash))?.data ?? '0x');
   if (receipt.status !== 1 || !transferProven(receipt.logs,network.token,row.wallet_address,job.receiver,BigInt(decoded[1]),id('Transfer(address,address,uint256)'))) {
    await update({status:'failed',error_message:'লেনদেনে G$ পৌঁছানোর প্রমাণ পাওয়া যায়নি',signed_tx:null,encrypted_key:null,lease_until:null}); return;
   }
   await update({status:'success',error_message:null,signed_tx:null,encrypted_key:null,lease_until:null});
  } catch (error) {
   const message = String(error instanceof Error ? error.message : '');
   if (prepared) { await update({status:'confirming',error_message:'নেটওয়ার্কের নিশ্চিত ফলাফলের অপেক্ষা',lease_until:new Date(Date.now()+60000).toISOString()}); }
   else {
    const gasFailure = /insufficient funds|gas required|intrinsic gas/i.test(message);
    const terminal = gasFailure || row.attempts>=3;
    await update({status:terminal?'failed':'pending',error_message:gasFailure?'গ্যাস ফি পর্যাপ্ত নয়':'নেটওয়ার্কে চেষ্টা সফল হয়নি',encrypted_key:terminal?null:row.encrypted_key,lease_until:terminal?null:new Date(Date.now()+30000).toISOString()});
   }
  } finally { provider.destroy(); }
 }));
 return {processed:rows?.length ?? 0};
}
