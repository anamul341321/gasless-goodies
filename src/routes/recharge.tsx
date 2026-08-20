import { createFileRoute } from "@tanstack/react-router";
import Recharge from "@/pages/Recharge";

export const Route = createFileRoute("/recharge")({
  component: Recharge,
});
