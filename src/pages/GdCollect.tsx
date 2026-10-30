import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowDownToLine, Play, Square, Loader2, ChevronLeft, ChevronRight, ExternalLink, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { createCollection, uploadCollection, startCollection, stopCollection, collectionStatus } from '@/lib/collection.functions';
import { COLLECTION_NETWORKS, parseCollectionKeys, receiverAddress, UPLOAD_CHUNK } from '@/lib/collection/rules';
import { toast } from 'sonner';
const labels:Record<string,string>={uploading:'কী জমা হচ্ছে',running:'সংগ্রহ চলছে',stopping:'থামছে',stopped:'থেমেছে',completed:'সম্পন্ন',pending:'অপেক্ষায়',processing:'পাঠানোর প্রস্তুতি',confirming:'নিশ্চিত হওয়ার অপেক্ষায়',success:'সংগ্রহ হয়েছে',failed:'ব্যর্থ',empty:'G$ নেই',cancelled:'বাতিল'};
export default function GdCollect(){
 const {user,loading}=useAuth();
 const [network,setNetwork]=useState<'celo'|'xdc'>('celo');
 const [name,setName]=useState('');const [receiver,setReceiver]=useState('');const [keys,setKeys]=useState('');
 const [busy,setBusy]=useState(false);const [upload,setUpload]=useState(0);const [selected,setSelected]=useState<string>();const [fresh,setFresh]=useState(false);const [page,setPage]=useState(0);
 const create=useServerFn(createCollection);const save=useServerFn(uploadCollection);const start=useServerFn(startCollection);const stop=useServerFn(stopCollection);const status=useServerFn(collectionStatus);
 const query=useQuery({queryKey:['gd-collection',user?.id,selected,page],queryFn:()=>status({data:{jobId:selected,page}}),enabled:!!user,refetchInterval:5000});
 useEffect(()=>{setSelected(undefined);setPage(0)},[user?.id]);
 const job=fresh?null:query.data?.job;const summary=query.data?.summary as null|{total:number;success:number;failed:number;empty:number;cancelled:number;pending:number;collected:string};
 async function run(){setBusy(true);try{
  const wallets=parseCollectionKeys(keys);const destination=receiverAddress(receiver);
  if(wallets.some(w=>w.address===destination.toLowerCase())) throw new Error('সংগ্রহের ঠিকানা কী তালিকায় রয়েছে');
  const created=await create({data:{clientId:crypto.randomUUID(),name:name.trim()||'G$ সংগ্রহ',network,receiver:destination}});
  setSelected(created.id);setUpload(0);
  for(let i=0;i<wallets.length;i+=UPLOAD_CHUNK){await save({data:{jobId:created.id,keys:wallets.slice(i,i+UPLOAD_CHUNK).map(w=>w.key)}});setUpload(Math.min(i+UPLOAD_CHUNK,wallets.length));}
  await start({data:{jobId:created.id}});setKeys('');setFresh(false);setPage(0);await query.refetch();toast.success('ব্যাচ চালু হয়েছে');
 }catch(error){toast.error(error instanceof Error?error.message:'কাজ চালু হয়নি')}finally{setBusy(false)}}
 async function halt(){if(!job)return;setBusy(true);try{await stop({data:{jobId:job.id}});await query.refetch();toast.success('থামানোর অনুরোধ দেওয়া হয়েছে')}catch{toast.error('থামানো যায়নি')}finally{setBusy(false)}}
 return <main className="min-h-screen bg-background text-foreground"><div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
 <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground"><ArrowLeft className="w-4 h-4"/>ড্যাশবোর্ড</Link>
 <header className="flex items-center gap-4"><div className="icon-cyan p-3 rounded-lg"><ArrowDownToLine className="w-8 h-8"/></div><div><h1 className="text-2xl font-bold">একসাথে G$ সংগ্রহ</h1><p className="text-muted-foreground">Celo · XDC</p></div></header>
 {loading?<Loader2 className="animate-spin"/>:!user?<Link to="/auth"><Button>সংগ্রহ করতে লগইন করুন</Button></Link>:<>
 <div className="flex flex-wrap gap-3 items-center"><Button variant={fresh?'default':'outline'} onClick={()=>{setFresh(true);setPage(0)}}><Plus className="w-4 h-4"/>নতুন ব্যাচ</Button><select aria-label="আমার ব্যাচ" className="bg-background border border-border rounded-md p-2 min-w-0 max-w-full" value={fresh?'':job?.id??''} onChange={e=>{setSelected(e.target.value);setFresh(false);setPage(0)}}><option value="">আমার ব্যাচ</option>{query.data?.jobs.map(j=><option key={j.id} value={j.id}>{j.name} · {j.network.toUpperCase()} · {labels[j.status]}</option>)}</select></div>
 {(!job||fresh)&&<section className="space-y-5 border-t border-border pt-5"><div className="flex gap-2">{(['celo','xdc'] as const).map(n=><Button key={n} variant={network===n?'default':'outline'} onClick={()=>setNetwork(n)} disabled={busy}>{n==='celo'?'Celo':'XDC'}</Button>)}</div><div className="grid sm:grid-cols-2 gap-4"><label className="space-y-2"><span>ব্যাচের নাম</span><Input value={name} maxLength={80} onChange={e=>setName(e.target.value)} disabled={busy}/></label><label className="space-y-2"><span>G$ গ্রহণের ঠিকানা</span><Input value={receiver} placeholder="0x…" onChange={e=>setReceiver(e.target.value)} disabled={busy}/></label></div><label className="block space-y-2"><span>ওয়ালেটের প্রাইভেট কী</span><Textarea className="min-h-56 font-mono text-sm" value={keys} onChange={e=>setKeys(e.target.value)} placeholder="প্রতি লাইনে একটি কী" disabled={busy} spellCheck={false}/></label><p className="text-sm text-muted-foreground flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0"/>শুধু নিজের ওয়ালেট দিন। প্রতিটি ওয়ালেটে লেনদেনের গ্যাস ফি থাকতে হবে।</p><p className="text-sm text-muted-foreground">সব কী জমা হয়ে ব্যাচ চালু হওয়ার পরে ফোন বা ইন্টারনেট বন্ধ হলেও কাজ চলবে।</p><Button size="lg" onClick={run} disabled={busy||!keys.trim()||!receiver.trim()}>{busy?<Loader2 className="w-4 h-4 animate-spin"/>:<Play className="w-4 h-4"/>}{busy?`${upload.toLocaleString('bn-BD')}টি জমা হয়েছে`:'G$ সংগ্রহ শুরু করুন'}</Button></section>}
 {job&&<section className="space-y-5 border-t border-border pt-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">{job.name}</h2><p className="text-primary">{labels[job.status]} · {job.network.toUpperCase()}</p></div>{['running','uploading'].includes(job.status)&&<Button variant="destructive" onClick={halt} disabled={busy}><Square className="w-4 h-4"/>থামান</Button>}</div><p className="font-mono text-xs break-all text-muted-foreground">{job.receiver}</p>{job.status==='stopping'&&<p className="text-sm text-muted-foreground">ইতিমধ্যে পাঠানো লেনদেন শেষ হলে পুরো ব্যাচ থামবে।</p>}{job.status==='uploading'&&<p className="text-sm text-muted-foreground">কী জমা অসম্পূর্ণ। এই ব্যাচ থামিয়ে নতুন ব্যাচ দিন।</p>}
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[['মোট',summary?.total],['সংগ্রহ হয়েছে',summary?.success],['ব্যর্থ',summary?.failed],['অপেক্ষায়',summary?.pending]].map(([label,value])=><div key={label} className="border border-border rounded-lg p-4"><div className="text-muted-foreground text-sm">{label}</div><strong className="text-2xl">{Number(value??0).toLocaleString('bn-BD')}</strong></div>)}</div><div className="py-4 border-y border-border"><p className="text-muted-foreground">মোট সংগ্রহ</p><strong className="text-2xl break-all">{summary?.collected??'0'} G$</strong><p className="text-sm text-muted-foreground">G$ নেই: {summary?.empty??0} · বাতিল: {summary?.cancelled??0}</p></div>
 <div className="space-y-2">{query.data?.items.map(item=><div key={item.id} className="border border-border rounded-lg p-3 flex gap-3 justify-between"><div className="min-w-0"><p className="font-mono text-xs break-all">{item.wallet_address}</p><p className={item.status==='success'?'text-primary text-sm':'text-muted-foreground text-sm'}>{labels[item.status]}{item.amount?` · ${item.amount} G$`:''}</p>{item.error_message&&<p className="text-sm text-destructive">{item.error_message}</p>}</div>{item.tx_hash&&<a title="লেনদেন দেখুন" href={COLLECTION_NETWORKS[job.network as 'celo'|'xdc'].explorer+item.tx_hash} target="_blank" rel="noreferrer" className="text-primary"><ExternalLink className="w-4 h-4"/></a>}</div>)}</div>
 <div className="flex items-center justify-between"><Button variant="outline" disabled={page===0} onClick={()=>setPage(p=>p-1)} aria-label="আগের পাতা"><ChevronLeft/></Button><span>{(page+1).toLocaleString('bn-BD')}</span><Button variant="outline" disabled={(page+1)*100>=(summary?.total??0)} onClick={()=>setPage(p=>p+1)} aria-label="পরের পাতা"><ChevronRight/></Button></div></section>}
 {query.isError&&<p className="text-destructive">ব্যাচ দেখা যাচ্ছে না। আবার চেষ্টা করুন।</p>}
 </>}
 </div></main>
}
