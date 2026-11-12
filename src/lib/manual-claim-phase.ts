export type ManualGasPhase = "none" | "requesting" | "gas_done" | "retrying" | "retried";

// Completion of a faucet job is not evidence that gas was delivered.
export function manualClaimStage(status: string, gasPhase?: string) {
  if (status === "completed") return "completed";
  if (gasPhase === "requesting") return "requesting";
  if (gasPhase === "gas_done") return "waiting_retry";
  if (gasPhase === "retrying") return "retrying";
  return "claiming";
}