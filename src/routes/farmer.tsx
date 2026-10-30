import { createFileRoute } from "@tanstack/react-router";
import Farmer from "@/pages/Farmer";
import { appHead } from "@/lib/route-head";
export const Route = createFileRoute("/farmer")({
  head: () => appHead("G$ পাঠানো ও CELO সংগ্রহ", "Celo ও XDC সুবিধা, নিজের অ্যাকাউন্ট ও ব্যক্তিগত ফলাফল।"),
  component: Farmer,
});
