import { appHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import NanoCollect from "@/pages/NanoCollect";

export const Route = createFileRoute("/nano-collect")({
  head: () => appHead("NanoPay সংগ্রহ", "Good-App — NanoPay সংগ্রহ, নিজের ওয়ালেটের কাজ ও ব্যক্তিগত ফলাফল।"),
  component: NanoCollect,
});
