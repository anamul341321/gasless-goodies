import { createFileRoute } from "@tanstack/react-router";
import Claim from "@/pages/Claim";

export const Route = createFileRoute("/claim")({
  component: Claim,
});
