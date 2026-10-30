import { createFileRoute } from "@tanstack/react-router";
import BatchHistory from "@/pages/BatchHistory";
import { appHead } from "@/lib/route-head";
export const Route = createFileRoute("/batch-history")({
  head: () => appHead("আমার গ্যাসের ইতিহাস", "Celo ও XDC সুবিধা, নিজের অ্যাকাউন্ট ও ব্যক্তিগত ফলাফল।"),
  component: BatchHistory,
});
