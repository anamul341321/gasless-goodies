import { createFileRoute } from "@tanstack/react-router";
import RedirectHome from "@/pages/RedirectHome";

// Old public route silently redirects home
export const Route = createFileRoute("/farmer")({
  component: RedirectHome,
});
