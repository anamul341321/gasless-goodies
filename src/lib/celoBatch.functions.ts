import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { MAX_CELO_RECIPIENTS } from './celo-batch/rules';
const sendSchema=z.object({key:z.string().regex(/^(0x)?[a-fA-F0-9]{64}$/),recipients:z.array(z.string().max(42)).min(1).max(MAX_CELO_RECIPIENTS),amount:z.string().max(80)});
export const quoteCeloBatch=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(sendSchema)
 .handler(async ({data})=>{
  const {estimateCeloSend}=await import('./celo-batch/transfer.server');
  return estimateCeloSend(data.key.startsWith('0x')?data.key:'0x'+data.key,data.recipients,data.amount);
 });
export const submitCeloBatch=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(sendSchema.extend({clientId:z.uuid()}))
 .handler(async ({data,context})=>{
  const {data:existing,error:existingError}=await context.supabase.from('celo_batch_jobs').select('id').eq('owner_user_id',context.userId).eq('client_id',data.clientId).maybeSingle();
  if(existingError) throw new Error('আগের অনুরোধ পরীক্ষা করা যায়নি');
  if(existing) return {id:existing.id};
  const key=data.key.startsWith('0x')?data.key:'0x'+data.key;
  const {estimateCeloSend}=await import('./celo-batch/transfer.server');
  const quote=await estimateCeloSend(key,data.recipients,data.amount);
  if(!quote.sufficient) throw new Error(`মূল ওয়ালেটে অন্তত ${quote.required} CELO প্রয়োজন; গ্যাসের খরচসহ`);
  const {encryptCollectionKey}=await import('./collection/crypto.server');
  const encrypted=await encryptCollectionKey(key);
  const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
  const {data:id,error}=await supabaseAdmin.rpc('create_celo_batch',{p_owner:context.userId,p_client:data.clientId,p_sender:quote.sender,p_key:encrypted,p_amount:quote.amount,p_recipients:quote.recipients});
  if(error||!id) throw new Error('ব্যাচ চালু হয়নি; এই মূল ওয়ালেটে অন্য ব্যাচ চলছে কি না দেখুন');
  const {processCeloWave}=await import('./celo-batch/worker.server');
  // Immediate bounded work; a durable callback continues even if the browser closes.
  await processCeloWave();
  return {id};
 });
export const celoBatchStatus=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(z.object({jobId:z.uuid().optional()}))
 .handler(async ({data,context})=>{
  let query=context.supabase.from('celo_batch_jobs').select('id,sender_address,amount,total,status,last_error,created_at,finished_at').eq('owner_user_id',context.userId);
  if(data.jobId) query=query.eq('id',data.jobId);
  const {data:job,error}=await query.order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error) throw new Error('ফলাফল দেখা যাচ্ছে না');
  if(!job) return {job:null,chunks:[]};
  // Maximum 134 chunks for 10000 receivers: no capped recipient read.
  const {data:chunks,error:readError}=await context.supabase.from('celo_batch_chunks').select('id,position,recipients,status,tx_hash,error_message').eq('job_id',job.id).eq('owner_user_id',context.userId).order('position').limit(200);
  if(readError) throw new Error('প্রাপকদের ফলাফল দেখা যাচ্ছে না');
  return {job,chunks:chunks??[]};
 });
export const stopCeloBatch=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(z.object({jobId:z.uuid()}))
 .handler(async ({data,context})=>{
  const {data:stopped,error}=await context.supabase.rpc('stop_celo_batch',{p_job:data.jobId});
  if(error||!stopped) throw new Error('এই ব্যাচ থামানো যায়নি');
  return {stopped:true};
 });