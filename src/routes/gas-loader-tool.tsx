import { createFileRoute } from "@tanstack/react-router";
import GasLoader from "@/pages/GasLoader";
import { appHead } from "@/lib/route-head";
export const Route = createFileRoute("/gas-loader-tool")({
  head: () => appHead("ফ্রি গ্যাস — টুল", "Celo ও XDC সুবিধা, নিজের অ্যাকাউন্ট ও ব্যক্তিগত ফলাফল।"),
  component: GasLoader,
});
