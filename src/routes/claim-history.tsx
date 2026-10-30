import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import ClaimHistory from "@/pages/ClaimHistory";

export const Route = createFileRoute("/claim-history")({
  head: () => appHead("আমার ক্লেইমের ইতিহাস", "Good-App — আমার ক্লেইমের ইতিহাস, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: ClaimHistory,
});
