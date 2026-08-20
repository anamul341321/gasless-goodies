import { createFileRoute } from "@tanstack/react-router";
import BaseEthSender from "@/pages/BaseEthSender";

export const Route = createFileRoute("/base-multisend")({
  component: BaseEthSender,
});
