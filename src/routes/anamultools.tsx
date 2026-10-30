import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import SecretTools from "@/pages/SecretTools";

export const Route = createFileRoute("/anamultools")({
  head: () => appHead("G$ ও CELO সুবিধা", "Good-App — G$ ও CELO সুবিধা, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: SecretTools,
});
