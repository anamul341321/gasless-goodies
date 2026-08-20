import { createFileRoute } from "@tanstack/react-router";
import NanoCollect from "@/pages/NanoCollect";

export const Route = createFileRoute("/nano-collect")({
  component: NanoCollect,
});
