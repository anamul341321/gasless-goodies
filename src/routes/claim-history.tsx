import { createFileRoute } from "@tanstack/react-router";
import ClaimHistory from "@/pages/ClaimHistory";

export const Route = createFileRoute("/claim-history")({
  component: ClaimHistory,
});
