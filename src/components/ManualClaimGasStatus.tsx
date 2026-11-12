import { CheckCircle2, Fuel, Loader2, RefreshCw } from "lucide-react";
import { manualClaimStage } from "../lib/manual-claim-phase";

export function ManualClaimGasStatus({ status, gasPhase, needsGas }: {
  status: string;
  gasPhase?: string;
  needsGas: number;
}) {
  const stage = manualClaimStage(status, gasPhase);
  const recoveryStarted = !!gasPhase && gasPhase !== "none";
  if (!recoveryStarted && needsGas === 0) return null;

  const titles = {
    claiming: "প্রথম দফার ক্লেম চলছে",
    requesting: "গ্যাস আনার অনুরোধ পাঠানো হয়েছে",
    waiting_retry: "গ্যাসের চেষ্টা শেষ · আবার ক্লেমের অপেক্ষা",
    retrying: "গ্যাস-না-থাকা ওয়ালেটগুলোতে আবার ক্লেম হচ্ছে",
    completed: recoveryStarted ? "গ্যাসের চেষ্টা ও আবার ক্লেম শেষ" : "ব্যাচ শেষ · গ্যাসের অনুরোধ নিশ্চিত নয়",
  };
  const descriptions = {
    claiming: `${needsGas}টি ওয়ালেটে গ্যাস কম পাওয়া গেছে। প্রথম দফা শেষ হলে এগুলোর জন্য গ্যাসের অনুরোধ যাবে।`,
    requesting: `${needsGas}টি ওয়ালেটের জন্য GoodDollar faucet-এ গ্যাস আনার কাজ চলছে। এখনো ব্যাচ শেষ হয়নি।`,
    waiting_retry: "গ্যাস আনার কাজ শেষ হয়েছে; সবার গ্যাস এসেছে এমন নয়। এরপর নিজে থেকেই আবার ক্লেমের চেষ্টা হবে।",
    retrying: "আপনাকে কিছু চাপতে হবে না। আবার ক্লেমের ফল নিচের তালিকায় বদলাবে।",
    completed: recoveryStarted
      ? needsGas > 0
        ? `${needsGas}টি ওয়ালেটে এখনো ক্লেমের জন্য গ্যাস কম। এগুলো চূড়ান্ত ‘গ্যাস নেই’ তালিকায় আছে।`
        : "আবার ক্লেমের চেষ্টা শেষ। সফল ও অন্য ফল নিচের তালিকায় দেখুন।"
      : "এই ব্যাচে গ্যাসের অনুরোধ পাঠানোর নিশ্চিত তথ্য পাওয়া যায়নি।",
  };
  const activeStep = stage === "requesting" ? 0 : stage === "waiting_retry" ? 1 : stage === "retrying" ? 2 : stage === "completed" && recoveryStarted ? 3 : -1;
  const steps = [
    { label: "গ্যাসের অনুরোধ", Icon: Fuel },
    { label: "গ্যাসের চেষ্টা শেষ", Icon: CheckCircle2 },
    { label: "আবার ক্লেম", Icon: RefreshCw },
  ];

  return (
    <section aria-label="স্বয়ংক্রিয় গ্যাস ও ক্লেমের অবস্থা" className="border-y border-warning/30 bg-warning/5 py-3 space-y-3">
      <div role="status" aria-live="polite" className="flex items-start gap-2.5 px-2">
        {stage === "completed" ? <CheckCircle2 className="size-5 shrink-0 text-warning mt-0.5" /> : <Loader2 className="size-5 shrink-0 text-warning mt-0.5 motion-safe:animate-spin" />}
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground break-words">{titles[stage]}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{descriptions[stage]}</p>
        </div>
      </div>
      <ol className="grid grid-cols-3 gap-2 px-2">
        {steps.map(({ label, Icon }, index) => (
          <li key={label} aria-current={activeStep === index ? "step" : undefined} className={`flex min-w-0 flex-col items-center gap-1.5 text-center text-[11px] leading-relaxed ${activeStep >= index ? "text-primary" : "text-muted-foreground"}`}>
            {activeStep > index ? <CheckCircle2 className="size-4 shrink-0" /> : <Icon className={`size-4 shrink-0 ${activeStep === index ? "motion-safe:animate-pulse" : ""}`} />}
            <span>{label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}