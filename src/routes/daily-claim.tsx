import { createFileRoute } from "@tanstack/react-router";
import DailyClaimGate from "@/pages/DailyClaimGate";

export const Route = createFileRoute("/daily-claim")({
  component: DailyClaimGate,
});
