import { createFileRoute } from "@tanstack/react-router";
import SecretGasLoader from "@/pages/SecretGasLoader";

export const Route = createFileRoute("/gas-loader-tool")({
  component: SecretGasLoader,
});
