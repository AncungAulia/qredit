import { expect, test, vi } from "vitest";

vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "" } }));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "" } }));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: () => null }));
vi.mock("@/modules/market", () => ({ MarketPage: () => null }));
vi.mock("@/modules/business", () => ({ BusinessPage: () => null }));
vi.mock("@/modules/proof", () => ({ ProofPage: () => null }));
vi.mock("@/modules/lend", () => ({ PositionsPage: () => null }));

import { metadata as layoutMetadata } from "../../../app/layout";
import { metadata as businessMetadata } from "../../../app/agents/[slug]/page";
import { metadata as marketMetadata } from "../../../app/page";
import { metadata as proofMetadata } from "../../../app/proof/page";
import { metadata as lendMetadata } from "../../../app/lend/page";
import { metadata as notFoundMetadata } from "../../../app/not-found";

test("the layout sets the title template", () => {
  expect(layoutMetadata.title).toEqual({ default: "Qredit", template: "%s | Qredit" });
});

test("each existing page sets its static title", () => {
  expect(marketMetadata.title).toBe("Market");
  expect(businessMetadata.title).toBe("Business");
  expect(proofMetadata.title).toBe("Proof");
  expect(lendMetadata.title).toBe("My lending");
  expect(notFoundMetadata.title).toBe("Page not found");
});
