import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import Terms from "@/pages/Terms";

export const Route = createFileRoute("/terms")({
  head: () => appHead("ব্যবহারের শর্ত", "Good-App — ব্যবহারের শর্ত, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: Terms,
});
