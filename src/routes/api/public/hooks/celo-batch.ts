import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
export const Route=createFileRoute('/api/public/hooks/celo-batch')({server:{handlers:{POST:async({request})=>{
 const secret=request.headers.get('x-collection-token');
 if(!secret||!/^[a-f\d]{64}$/.test(secret)) return new Response('Unauthorized',{status:401});
 const url=process.env['SUPABASE_URL']; const key=process.env['SUPABASE_PUBLISHABLE_KEY'];
 if(!url||!key) return new Response('Unavailable',{status:503});
 const client=createClient(url,key,{auth:{persistSession:false},global:{fetch:(input,init)=>{
  const headers=new Headers(init?.headers);if(key.startsWith('sb_'))headers.delete('authorization');headers.set('apikey',key);return fetch(input,{...init,headers});
 }}});
 const {data:verified,error}=await client.rpc('verify_gd_collection_callback',{p_token:secret});
 if(error||!verified)return new Response('Unauthorized',{status:401});
 const {processCeloWave}=await import('@/lib/celo-batch/worker.server');
 const deadline=Date.now()+38000;
 do {const result=await processCeloWave();if(!result.processed)break;} while(Date.now()<deadline);
 return Response.json({ok:true});
}}}});