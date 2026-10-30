import { Link } from "@/lib/router-compat";
import { ArrowLeft } from "lucide-react";
import appLogo from "@/assets/logo.png";
export default function About() {
  return <main className="min-h-screen bg-background text-foreground p-5"><div className="max-w-3xl mx-auto space-y-8 py-4">
    <Link to="/" className="inline-flex items-center gap-2 text-primary"><ArrowLeft className="h-4 w-4" />ড্যাশবোর্ডে ফিরুন</Link>
    <header className="flex items-center gap-4"><img src={appLogo} width={64} height={64} alt="Good-App" className="rounded-xl" /><h1 className="text-3xl font-bold">Good-App পরিচিতি</h1></header>
    <section className="space-y-3"><h2 className="text-xl font-semibold">ওয়ালেটের কাজ এক জায়গায়</h2><p className="leading-8 text-muted-foreground">Good-App এ Celo ও XDC গ্যাস নেওয়া, G$ ক্লেইম, সময় ঠিক করে অটো ক্লেইম, ব্যাচে G$ সংগ্রহ, G$ পাঠানো এবং CELO সংগ্রহের সুবিধা রয়েছে।</p></section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">নিজের ফলাফল</h2><p className="leading-8 text-muted-foreground">গ্যাস ও ক্লেইমের ফলাফল নিজের অ্যাকাউন্টে দেখা যায়। অন্য ব্যবহারকারীর ইতিহাস দেখার অনুমতি নেই।</p></section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">নেটওয়ার্কের ওপর নির্ভরশীল</h2><p className="leading-8 text-muted-foreground">গ্যাস পাওয়া ও ক্লেইম সম্পন্ন হওয়া সংশ্লিষ্ট নেটওয়ার্ক এবং গ্যাস প্রদানকারীর নিয়মের ওপর নির্ভর করে। নির্দিষ্ট সময় বা পরিমাণ নিশ্চিত নয়।</p></section>
  </div></main>;
}
