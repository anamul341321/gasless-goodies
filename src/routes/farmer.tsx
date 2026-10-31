import { createFileRoute } from "@tanstack/react-router";
import Farmer from "@/pages/Farmer";
import { appHead } from "@/lib/route-head";
export const Route = createFileRoute("/farmer")({
  head: () => appHead("CELO পাঠানো ও সংগ্রহ", "নিজের মূল ওয়ালেট থেকে বহু ঠিকানায় সমান CELO পাঠান এবং ব্যক্তিগত ফলাফল দেখুন।"),
  component: Farmer,
});
