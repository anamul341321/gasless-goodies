import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { parseCollectionKeys, receiverAddress, UPLOAD_CHUNK, MAX_COLLECTION_KEYS } from './collection/rules';
const idSchema = z.object({ jobId: z.uuid() });
export const createCollection = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
 .inputValidator(z.object({ clientId: z.uuid(), name: z.string().max(80), network: z.enum(['celo','xdc']), receiver: z.string().max(60) }))
 .handler(async ({ data, context }) => {
  const receiver = receiverAddress(data.receiver);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: job, error } = await supabaseAdmin.from('gd_collection_jobs').upsert({ owner_user_id: context.userId, client_id: data.clientId, name: data.name, network: data.network, receiver }, { onConflict: 'owner_user_id,client_id', ignoreDuplicates: true });
  if (error) throw new Error('ব্যাচ তৈরি হয়নি');
  void job;
  const { data: existing, error: readError } = await context.supabase.from('gd_collection_jobs').select('id').eq('client_id',data.clientId).single();
  if (readError || !existing) throw new Error('ব্যাচ পাওয়া যায়নি');
  return existing;
 });
export const uploadCollection = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
 .inputValidator(z.object({ jobId: z.uuid(), keys: z.array(z.string().max(66)).min(1).max(UPLOAD_CHUNK) }))
 .handler(async ({ data, context }) => {
  const { data: job } = await context.supabase.from('gd_collection_jobs').select('id,status,receiver').eq('id',data.jobId).single();
  if (!job || job.status !== 'uploading') throw new Error('এই ব্যাচে কী যোগ করা যাবে না');
  const wallets = parseCollectionKeys(data.keys.join('\n'));
  if (wallets.some(w => w.address === job.receiver.toLowerCase())) throw new Error('সংগ্রহের ঠিকানা ও পাঠানোর ওয়ালেট একই হতে পারবে না');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { encryptCollectionKey } = await import('./collection/crypto.server');
  const rows = await Promise.all(wallets.map(async w => ({ job_id: job.id, owner_user_id: context.userId, wallet_address: w.address, encrypted_key: await encryptCollectionKey(w.key) })));
  const { error } = await supabaseAdmin.from('gd_collection_items').upsert(rows, { onConflict: 'job_id,wallet_address', ignoreDuplicates: true });
  if (error) throw new Error('কী সেভ হয়নি; আবার চেষ্টা করুন');
  return { uploaded: rows.length };
 });
export const startCollection = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(idSchema)
 .handler(async ({ data, context }) => {
  const { data: owned } = await context.supabase.from('gd_collection_jobs').select('id,status').eq('id',data.jobId).single();
  if (!owned || owned.status !== 'uploading') throw new Error('ব্যাচ পাওয়া যায়নি');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { count } = await supabaseAdmin.from('gd_collection_items').select('id',{count:'exact',head:true}).eq('job_id',owned.id);
  if (!count || count>MAX_COLLECTION_KEYS) throw new Error('১ থেকে ১০,০০০টি ওয়ালেট দিন');
  const { error } = await supabaseAdmin.from('gd_collection_jobs').update({ status:'running',total:count }).eq('id',owned.id).eq('status','uploading');
  if (error) throw new Error('চালু করা যায়নি');
  return { id: owned.id };
 });
export const stopCollection = createServerFn({ method:'POST' }).middleware([requireSupabaseAuth]).inputValidator(idSchema)
 .handler(async ({ data,context }) => {
  const { data: stopped, error } = await context.supabase.rpc('stop_gd_collection',{p_job:data.jobId});
  if (error || !stopped) throw new Error('এই ব্যাচ এখন থামানো যায় না');
  return { stopped:true };
 });
export const collectionStatus = createServerFn({ method:'POST' }).middleware([requireSupabaseAuth])
 .inputValidator(z.object({ jobId: z.uuid().optional(), page: z.number().int().min(0).max(100).default(0) }))
 .handler(async ({ data,context }) => {
  const { data: jobs,error } = await context.supabase.from('gd_collection_jobs').select('*').order('created_at',{ascending:false}).limit(50);
  if (error) throw new Error('ব্যাচ দেখা যাচ্ছে না');
  const job = data.jobId ? jobs?.find(j=>j.id===data.jobId) : jobs?.[0];
  if (!job) return {jobs:jobs ?? [],job:null,summary:null,items:[]};
  const { data: summary } = await context.supabase.rpc('gd_collection_summary',{p_job:job.id});
  const { data: items } = await context.supabase.from('gd_collection_items').select('id,wallet_address,status,amount,tx_hash,error_message').eq('job_id',job.id).order('created_at').order('id').range(data.page*100,data.page*100+99);
  return {jobs:jobs ?? [],job,summary,items:items ?? []};
 });
