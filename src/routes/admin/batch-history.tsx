import { createFileRoute } from "@tanstack/react-router";
import SecretBatchHistory from "@/pages/SecretBatchHistory";

export const Route = createFileRoute("/admin/batch-history")({
  component: SecretBatchHistory,
});
