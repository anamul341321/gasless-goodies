import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import Claim from "@/pages/Claim";

export const Route = createFileRoute("/claim")({
  head: () => appHead("G$ ক্লেইম", "Good-App — G$ ক্লেইম, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: Claim,
});
