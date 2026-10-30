import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import Privacy from "@/pages/Privacy";

export const Route = createFileRoute("/privacy")({
  head: () => appHead("গোপনীয়তার নীতি", "Good-App — গোপনীয়তার নীতি, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: Privacy,
});
