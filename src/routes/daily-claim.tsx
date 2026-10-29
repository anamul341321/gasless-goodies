import { createFileRoute } from "@tanstack/react-router";
import DailyClaimGate from "@/pages/DailyClaim";

export const Route = createFileRoute("/daily-claim")({
  head: () => ({ meta: [
    { title: "Daily G$ Auto Claim — Good-App" },
    { name: "description", content: "Manage your Celo and XDC daily GoodDollar claim groups and current results." },
    { property: "og:title", content: "Daily G$ Auto Claim — Good-App" },
    { property: "og:description", content: "Manage your Celo and XDC daily GoodDollar claim groups and current results." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DailyClaimGate,
});
