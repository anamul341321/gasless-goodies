import { expect, it } from "vitest";
import { manualClaimStage } from "./manual-claim-phase";

it("keeps a running batch open while its faucet request is being processed", () => {
  expect(manualClaimStage("running", "requesting")).toBe("requesting");
});

it("does not treat a finished gas job as a finished claim or confirmed delivery", () => {
  expect(manualClaimStage("running", "gas_done")).toBe("waiting_retry");
});

it("distinguishes the automatic retry from the initial claim pass", () => {
  expect(manualClaimStage("running", "retrying")).toBe("retrying");
  expect(manualClaimStage("running", "none")).toBe("claiming");
});

it("only marks the claim completed after the parent batch completes", () => {
  expect(manualClaimStage("completed", "retried")).toBe("completed");
  expect(manualClaimStage("running", "retried")).not.toBe("completed");
});