import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import Auth from "@/pages/Auth";

export const Route = createFileRoute("/auth")({
  head: () => appHead("লগইন", "Good-App — লগইন, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: Auth,
});
