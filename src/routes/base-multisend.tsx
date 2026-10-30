import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import BaseEthSender from "@/pages/BaseEthSender";

export const Route = createFileRoute("/base-multisend")({
  head: () => appHead("Base ETH পাঠান", "Good-App — Base ETH পাঠান, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: BaseEthSender,
});
