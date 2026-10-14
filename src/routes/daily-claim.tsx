import { createFileRoute } from "@tanstack/react-router";
import DailyClaimGate from "@/pages/DailyClaim";

export const Route = createFileRoute("/daily-claim")({
  component: DailyClaimGate,
});
