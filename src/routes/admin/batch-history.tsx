import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import SecretBatchHistory from "@/pages/SecretBatchHistory";

export const Route = createFileRoute("/admin/batch-history")({
  head: () => appHead("পরিচালনা — গ্যাস ইতিহাস", "Good-App — পরিচালনা — গ্যাস ইতিহাস, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: SecretBatchHistory,
});
