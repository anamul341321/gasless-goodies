import { createFileRoute } from '@tanstack/react-router';
import { appHead } from '@/lib/route-head';
import GdCollect from '@/pages/GdCollect';
export const Route = createFileRoute('/gd-collect')({head:()=>appHead('একসাথে G$ সংগ্রহ','Celo ও XDC ওয়ালেট থেকে নিজের ঠিকানায় ব্যাচে G$ সংগ্রহ।'),component:GdCollect});
