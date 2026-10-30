import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import About from "@/pages/About";

export const Route = createFileRoute("/about")({
  head: () => appHead("পরিচিতি", "Good-App — পরিচিতি, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: About,
});
