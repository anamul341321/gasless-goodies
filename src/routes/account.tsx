import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import Account from "@/pages/Account";

export const Route = createFileRoute("/account")({
  head: () => appHead("আমার অ্যাকাউন্ট", "Good-App — আমার অ্যাকাউন্ট, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: Account,
});
