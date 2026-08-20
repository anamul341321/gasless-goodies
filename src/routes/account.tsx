import { createFileRoute } from "@tanstack/react-router";
import Account from "@/pages/Account";

export const Route = createFileRoute("/account")({
  component: Account,
});
