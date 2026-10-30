import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import SecretGasLoader from "@/pages/SecretGasLoader";

export const Route = createFileRoute("/admin/gas-loader")({
  head: () => appHead("পরিচালনা — গ্যাস নেওয়া", "Good-App — পরিচালনা — গ্যাস নেওয়া, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: SecretGasLoader,
});
