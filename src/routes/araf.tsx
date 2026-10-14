import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import DailyClaim from "@/pages/DailyClaim";
import GasLoader from "@/pages/GasLoader";

export const Route = createFileRoute("/araf")({
  head: () => ({
    meta: [
      { title: "Private Workspace" },
      { name: "description", content: "Private daily auto claim and gas loader workspace." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Private Workspace" },
      { property: "og:description", content: "Private daily auto claim and gas loader workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ArafPage,
});

function ArafPage() {
  const [tab, setTab] = useState<"claim" | "gas">("claim");
  return (
    <div>
      <div className="sticky top-0 z-50 flex justify-center gap-2 bg-background/80 p-3 backdrop-blur">
        {([
          ["claim", "Daily Auto Claim"],
          ["gas", "Manual Gas Load"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "claim" ? <DailyClaim /> : <GasLoader />}
    </div>
  );
}
