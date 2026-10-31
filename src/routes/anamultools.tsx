import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import SecretTools from "@/pages/SecretTools";

export const Route = createFileRoute("/anamultools")({
  head: () => appHead("একসাথে CELO পাঠান", "Good-App — সর্বোচ্চ ১০,০০০ ঠিকানায় নিজের নির্ধারিত সমান CELO পাঠান, গ্যাস নিন ও CELO সংগ্রহ করুন।"),
  component: SecretTools,
});
