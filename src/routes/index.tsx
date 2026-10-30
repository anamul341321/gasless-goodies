import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import Index from "@/pages/Index";

export const Route = createFileRoute("/")({
  head: () => appHead("ড্যাশবোর্ড", "Good-App — ড্যাশবোর্ড, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: Index,
});
