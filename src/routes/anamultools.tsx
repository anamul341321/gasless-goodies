import { createFileRoute } from "@tanstack/react-router";
import SecretTools from "@/pages/SecretTools";

export const Route = createFileRoute("/anamultools")({
  component: SecretTools,
});
