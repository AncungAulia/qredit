import { describe, expect, test } from "bun:test";
import { encodeFunctionData, getAbiItem } from "viem";
import {
  BOND_BPS, bondFor, FACTORY_ABI, FACTORY_ADDRESS, FACTORY_V1_ADDRESS, LOAN_VAULT_ABI, ORDER_STATUS, REVIEW_WINDOW_SECONDS,
  VAULT_ABI, VAULT_EVENTS, VAULT_EVENTS_V1, VAULT_STATE,
} from "../src/index.ts";
import { LOAN_VAULT_V1_ABI } from "../src/generated/abis-v1.ts";

const names = (abi: readonly { type: string; name?: string }[], type: string) => abi.filter((x) => x.type === type).map((x) => x.name);

describe("vault v2 constants", () => {
  test("the bond is 10 % of the target", () => {
    expect(BOND_BPS).toBe(1000n);
    expect(bondFor(50_000_000n)).toBe(5_000_000n);
    expect(bondFor(9n)).toBe(0n);
  });
  test("review window, states and order statuses follow the contract", () => {
    expect(REVIEW_WINDOW_SECONDS).toBe(86_400);
    expect(VAULT_STATE).toEqual({ Raising: 0, Active: 1, Trapped: 2, Repaid: 3, Refunded: 4, Defaulted: 5, Closed: 6 });
    expect(ORDER_STATUS).toEqual({ None: 0, Open: 1, InReview: 2, Settled: 3, Rejected: 4, Declined: 5, Reclaimed: 6 });
  });
  test("v1 and v2 factories differ", () => {
    expect(FACTORY_ADDRESS.toLowerCase()).not.toBe(FACTORY_V1_ADDRESS.toLowerCase());
  });
});

describe("events", () => {
  test("v2 events carry the review and the ending", () => {
    expect(names(VAULT_EVENTS, "event")).toEqual(["OrderPlaced", "Delivered", "Settled", "Rejected", "Declined", "Reclaimed", "LoanEnded", "AgentRotated"]);
    expect(getAbiItem({ abi: VAULT_EVENTS, name: "Delivered" }).inputs.map((i) => i.name)).toEqual(["orderId", "envelopeHash", "reviewEnds"]);
  });
  test("v1 events keep the split on Delivered", () => {
    expect(getAbiItem({ abi: VAULT_EVENTS_V1, name: "Delivered" }).inputs.map((i) => i.name)).toEqual(["orderId", "envelopeHash", "toLenders", "toOwner", "toOpex"]);
  });
});

describe("generated ABIs", () => {
  test("v2 vault has the new functions, errors and events", () => {
    const fns = names(LOAN_VAULT_ABI, "function");
    for (const f of ["accept", "settle", "reject", "triggerDefault", "defaultable", "selfPause", "withdrawBond", "bondHeld", "swept", "ended", "uniqueBuyers", "seenBuyer", "supplierCost", "REVIEW_WINDOW", "BOND_BPS"]) {
      expect(fns).toContain(f);
    }
    const errors = names(LOAN_VAULT_ABI, "error");
    for (const e of ["Ended", "OverOrderPrice", "NotInReview", "ReviewOpen", "ReviewOver", "OwnerClaimNotAhead", "NotDefaultable", "BuyerNotAllowed", "NotAgent"]) {
      expect(errors).toContain(e);
    }
    expect(errors).not.toContain("TrappedNoOwnerClaim");
    expect(names(LOAN_VAULT_ABI, "event")).toEqual(expect.arrayContaining(["Settled", "Rejected", "LoanEnded", "AgentRotated", "AgentPaused", "BondReturned"]));
  });
  test("v1 vault ABI is the frozen one", () => {
    expect(names(LOAN_VAULT_V1_ABI, "function")).not.toContain("accept");
    expect(names(LOAN_VAULT_V1_ABI, "error")).toContain("TrappedNoOwnerClaim");
  });
  test("human-readable ABIs encode v2 calls", () => {
    expect(encodeFunctionData({ abi: VAULT_ABI, functionName: "settle", args: [7n] }).length).toBe(2 + 8 + 64);
    expect(names(FACTORY_ABI, "function")).toContain("token");
  });
});
