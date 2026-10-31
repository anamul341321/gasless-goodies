import { createFileRoute } from "@tanstack/react-router";
import DailyClaimGate from "@/pages/DailyClaim";

export const Route = createFileRoute("/daily-claim")({
  head: () => ({ meta: [
    { title: "Daily G$ Auto Claim — Good-App" },
    { name: "description", content: "Celo, XDC ও Fuse-এ প্রতিদিনের G$ ক্লেইম গ্রুপ ও বর্তমান ব্যাচের সব ফলাফল।" },
    { property: "og:title", content: "Daily G$ Auto Claim — Good-App" },
    { property: "og:description", content: "Celo, XDC ও Fuse-এ প্রতিদিনের G$ ক্লেইম গ্রুপ ও বর্তমান ব্যাচের সব ফলাফল।" },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DailyClaimGate,
});
