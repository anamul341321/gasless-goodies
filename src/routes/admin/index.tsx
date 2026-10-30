import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import Admin from "@/pages/Admin";

export const Route = createFileRoute("/admin/")({
  head: () => appHead("পরিচালনা", "Good-App — পরিচালনা, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: Admin,
});
