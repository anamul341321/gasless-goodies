import { createFileRoute } from "@tanstack/react-router";
import SecretBatchHistory from "@/pages/SecretBatchHistory";

export const Route = createFileRoute("/batch-history-tool")({
  component: SecretBatchHistory,
});
