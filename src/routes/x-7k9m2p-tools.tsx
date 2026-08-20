import { createFileRoute } from "@tanstack/react-router";
import SecretTools from "@/pages/SecretTools";

// Backward compat: old secret URL still works
export const Route = createFileRoute("/x-7k9m2p-tools")({
  component: SecretTools,
});
