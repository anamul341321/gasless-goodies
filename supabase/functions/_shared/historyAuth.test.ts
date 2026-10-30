import { describe, expect, it } from "vitest";
import { ownsHistory } from "./historyAuth";

describe("private histories", () => {
  it("allows the owner of a gas-load history", () => { expect(ownsHistory("owner-a", "owner-a")).toBe(true); });
  it("denies another user's manual claim history", () => { expect(ownsHistory("owner-a", "owner-b")).toBe(false); });
  it("denies another user's auto claim history", () => { expect(ownsHistory("owner-b", "owner-a")).toBe(false); });
  it("denies unsigned callers", () => { expect(ownsHistory("owner-a", null)).toBe(false); });
  it("never adopts legacy ownerless history", () => { expect(ownsHistory(null, "owner-a")).toBe(false); });
  it("does not authorize two missing identities", () => { expect(ownsHistory(null, null)).toBe(false); });
});