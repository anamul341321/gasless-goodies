import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Fuel, Send, Loader2, Square, ExternalLink, Copy, RefreshCw, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { celoRecipients, celoTotal } from '@/lib/celo-batch/rules';
import { quoteCeloBatch, submitCeloBatch, celoBatchStatus, stopCeloBatch } from '@/lib/celoBatch.functions';

const labels:Record<string,string>={running:'পাঠানো চলছে',stopping:'বন্ধ হচ্ছে',stopped:'বন্ধ হয়েছে',completed:'ব্যাচ শেষ',failed:'ব্যর্থ',pending:'অপেক্ষায়',confirming:'নিশ্চিত হচ্ছে',success:'পাঠানো হয়েছে',cancelled:'বন্ধ করা হয়েছে'};
type Result=Awaited<ReturnType<typeof celoBatchStatus>>;
type Quote=Awaited<ReturnType<typeof quoteCeloBatch>>;
export default function CeloBatchSend(){
 const {user}=useAuth();
 const quoteFn=useServerFn(quoteCeloBatch),submitFn=useServerFn(submitCeloBatch),statusFn=useServerFn(celoBatchStatus),stopFn=useServerFn(stopCeloBatch);
 const [key,setKey]=useState(''),[addresses,setAddresses]=useState(''),[amount,setAmount]=useState('0.1');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[quote,setQuote]=useState<Quote|null>(null),[result,setResult]=useState<Result|null>(null);
 const [clientId,setClientId]=useState(''),[page,setPage]=useState(0);
 const active=result?.job&&['running','stopping'].includes(result.job.status);
 let recipients:string[]=[];let inputError='';let total='0';
 try{if(addresses.trim())recipients=celoRecipients(addresses);total=celoTotal(amount,recipients.length);}catch(e){inputError=e instanceof Error?e.message:'তথ্য সঠিক নয়';}
 const refresh=async()=>{try{setResult(await statusFn({data:{}}));}catch(e){setError(e instanceof Error?e.message:'ফলাফল দেখা যাচ্ছে না');}};
 useEffect(()=>{if(!user)return;void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[user?.id]);
 const changed=()=>{setQuote(null);setClientId('');setError('');};
 const check=async()=>{
  setBusy(true);setError('');try{const q=await quoteFn({data:{key,recipients,amount}});setQuote(q);setClientId(crypto.randomUUID());}catch(e){setError(e instanceof Error?e.message:'খরচ জানা যায়নি');}finally{setBusy(false);}
 };
 const send=async()=>{
  if(!quote?.sufficient||!clientId)return;
  if(!confirm(`${quote.recipients.length}টি ঠিকানায় প্রতিটিতে ${quote.amount} CELO পাঠাবেন?\nমোট ${quote.total} CELO, গ্যাসের খরচ আলাদা।\nপাঠানো CELO ফেরত আনা যাবে না।`))return;
  setBusy(true);setError('');try{await submitFn({data:{key,recipients:quote.recipients,amount:quote.amount,clientId}});setKey('');setQuote(null);setClientId('');await refresh();}catch(e){setError(e instanceof Error?e.message:'পাঠানো শুরু হয়নি');}finally{setBusy(false);}
 };
 const stop=async()=>{if(!result?.job||!confirm('যেগুলো এখনো পাঠানো হয়নি সেগুলো বন্ধ করবেন? পাঠানো লেনদেন বাতিল করা যায় না।'))return;try{await stopFn({data:{jobId:result.job.id}});await refresh();}catch(e){setError(e instanceof Error?e.message:'বন্ধ হয়নি');}};
 const rows=(result?.chunks??[]).flatMap(c=>Array.isArray(c.recipients)?(c.recipients as string[]).map(address=>({address,status:c.status,hash:c.tx_hash,error:c.error_message})):[]);
 const sent=rows.filter(r=>r.status==='success').length,failed=rows.filter(r=>r.status==='failed').length;
 const copyFailed=async()=>{try{await navigator.clipboard.writeText(rows.filter(r=>r.status==='failed').map(r=>r.address).join('\n'));}catch{setError('কপি হয়নি; আবার চেষ্টা করুন');}};
 return <section className="space-y-6">
  <header className="flex items-center gap-3"><div className="icon-emerald p-3 rounded-lg"><Fuel className="size-6"/></div><div><h1 className="text-xl font-bold">একসাথে CELO পাঠান</h1><Badge variant="outline">Celo Mainnet</Badge></div></header>
  {!active&&<div className="space-y-4">
   <div className="space-y-2"><label htmlFor="celo-main-key" className="text-sm font-medium">মূল ওয়ালেটের প্রাইভেট কী</label><Input id="celo-main-key" type="password" autoComplete="off" value={key} onChange={e=>{setKey(e.target.value);changed();}} placeholder="0x…" disabled={busy} className="font-mono"/></div>
   <div className="space-y-2"><label htmlFor="celo-each" className="text-sm font-medium">প্রতি ঠিকানায় CELO</label><Input id="celo-each" inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);changed();}} disabled={busy}/></div>
   <div className="space-y-2"><label htmlFor="celo-receivers" className="text-sm font-medium">প্রাপকের ঠিকানা · সর্বোচ্চ ১০,০০০টি</label><Textarea id="celo-receivers" value={addresses} onChange={e=>{setAddresses(e.target.value);changed();}} disabled={busy} rows={8} placeholder={'0x…\n0x…'} className="font-mono text-xs"/></div>
   <div className="flex flex-wrap justify-between gap-2 border-y border-border py-3 text-sm"><span>{recipients.length.toLocaleString('bn-BD')}টি ঠিকানা</span><span className="font-semibold">মোট {total} CELO</span></div>
   {inputError&&<p className="text-sm text-destructive">{inputError}</p>}
   {!quote&&<Button onClick={check} disabled={busy||!key||!recipients.length||!!inputError} className="w-full">{busy?<Loader2 className="size-4 animate-spin"/>:<Wallet className="size-4"/>}ব্যালেন্স ও খরচ দেখুন</Button>}
   {quote&&<div className="space-y-3 border-t border-border pt-4"><dl className="grid grid-cols-2 gap-2 text-sm"><dt className="text-muted-foreground">মূল ওয়ালেটে আছে</dt><dd className="text-right break-all">{quote.balance} CELO</dd><dt className="text-muted-foreground">আনুমানিক গ্যাসের খরচ</dt><dd className="text-right break-all">{quote.fees} CELO</dd><dt className="font-medium">খরচসহ প্রয়োজন</dt><dd className="text-right font-semibold break-all">{quote.required} CELO</dd></dl>
    <p className="text-xs text-muted-foreground">গ্যাসের খরচ আলাদা; প্রতিটি ঠিকানায় পুরো {quote.amount} CELO যাবে।</p>
    {!quote.sufficient&&<p className="text-sm text-destructive">মূল ওয়ালেটে পর্যাপ্ত CELO নেই।</p>}
    <Button onClick={send} disabled={busy||!quote.sufficient} className="w-full">{busy?<Loader2 className="size-4 animate-spin"/>:<Send className="size-4"/>}CELO পাঠান</Button>
   </div>}
  </div>}
  {error&&<p role="alert" className="text-sm text-destructive break-words">{error}</p>}
  {result?.job&&<section className="space-y-4 border-t border-border pt-5">
   <div className="flex items-center justify-between gap-2"><Badge>{labels[result.job.status]??result.job.status}</Badge><div className="flex gap-2"><Button size="icon" variant="ghost" aria-label="হালনাগাদ" onClick={()=>void refresh()}><RefreshCw className="size-4"/></Button>{result.job.status==='running'&&<Button variant="destructive" size="sm" onClick={stop}><Square className="size-4"/>বন্ধ করুন</Button>}</div></div>
   <div className="grid grid-cols-3 gap-2 text-center"><div><strong className="text-xl">{result.job.total.toLocaleString('bn-BD')}</strong><p className="text-xs text-muted-foreground">মোট</p></div><div><strong className="text-xl text-success">{sent.toLocaleString('bn-BD')}</strong><p className="text-xs text-muted-foreground">পাঠানো হয়েছে</p></div><div><strong className="text-xl text-destructive">{failed.toLocaleString('bn-BD')}</strong><p className="text-xs text-muted-foreground">ব্যর্থ</p></div></div>
   <p className="text-sm text-muted-foreground">প্রতি ঠিকানায় {result.job.amount} CELO</p>
   {failed>0&&<Button variant="outline" size="sm" onClick={copyFailed}><Copy className="size-4"/>ব্যর্থ ঠিকানা কপি করুন</Button>}
   <div className="space-y-2 max-h-96 overflow-y-auto">{rows.slice(page*100,page*100+100).map(r=><div key={r.address} className="border border-border rounded-lg p-3 space-y-1"><div className="flex items-center justify-between gap-2"><span className="font-mono text-xs truncate" title={r.address}>{r.address}</span><Badge variant={r.status==='failed'?'destructive':'secondary'} className="shrink-0 text-xs">{labels[r.status]}</Badge></div>{r.error&&<p className="text-xs text-destructive">{r.error}</p>}{r.hash&&<a href={`https://celoscan.io/tx/${r.hash}`} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex gap-1 items-center"><ExternalLink className="size-3"/>লেনদেন দেখুন</a>}</div>)}</div>
   {rows.length>100&&<div className="flex items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={page===0} onClick={()=>setPage(p=>p-1)}>আগেরগুলো</Button><span className="text-xs">{page+1} / {Math.ceil(rows.length/100)}</span><Button variant="outline" size="sm" disabled={(page+1)*100>=rows.length} onClick={()=>setPage(p=>p+1)}>পরেরগুলো</Button></div>}
  </section>}
 </section>;
}