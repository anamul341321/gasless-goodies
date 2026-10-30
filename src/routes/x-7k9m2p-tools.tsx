import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import SecretTools from "@/pages/SecretTools";

// Backward compat: old secret URL still works
export const Route = createFileRoute("/x-7k9m2p-tools")({
  head: () => appHead("ওয়ালেট সুবিধা", "Good-App — ওয়ালেট সুবিধা, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: SecretTools,
});
