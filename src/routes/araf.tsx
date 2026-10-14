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
      <div className="sticky top-0 z-50 flex justify-center p-3 bg-background/70 backdrop-blur-xl border-b border-border/50">
        <div className="flex gap-1 rounded-full border border-border/60 bg-muted/40 p-1 shadow-lg">
          {([
            ["claim", "⚡ Daily Auto Claim"],
            ["gas", "⛽ Manual Gas Load"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`premium-btn rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                tab === k
                  ? "bg-primary text-primary-foreground shadow-md scale-105"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div key={tab} className="animate-fade-up">
        {tab === "claim" ? <DailyClaim /> : <GasLoader />}
      </div>
    </div>
  );
}
