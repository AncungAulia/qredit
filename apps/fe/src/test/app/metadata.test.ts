import { expect, test, vi } from "vitest";

vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "" } }));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "" } }));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: () => null }));
vi.mock("@/modules/market", () => ({ MarketPage: () => null }));
vi.mock("@/modules/business", () => ({ BusinessPage: () => null }));
vi.mock("@/modules/proof", () => ({ ProofPage: () => null }));
vi.mock("@/modules/lend", () => ({ PositionsPage: () => null }));
vi.mock("@/modules/orders", () => ({ NewOrderPage: () => null }));
vi.mock("@/modules/inbox", () => ({ InboxPage: () => null, ReportPage: () => null }));

import { metadata as layoutMetadata } from "../../../app/layout";
import { metadata as businessMetadata } from "../../../app/agents/[slug]/page";
import { metadata as marketMetadata } from "../../../app/page";
import { metadata as proofMetadata } from "../../../app/proof/page";
import { metadata as lendMetadata } from "../../../app/lend/page";
import { metadata as shopMetadata } from "../../../app/shop/[slug]/page";
import { metadata as inboxMetadata } from "../../../app/inbox/page";
import { metadata as reportMetadata } from "../../../app/inbox/[vault]/[orderId]/page";
import { metadata as notFoundMetadata } from "../../../app/not-found";

test("the layout sets the title template", () => {
  expect(layoutMetadata.title).toEqual({ default: "Qredit", template: "%s | Qredit" });
});

test("each existing page sets its static title", () => {
  expect(marketMetadata.title).toBe("Market");
  expect(businessMetadata.title).toBe("Business");
  expect(proofMetadata.title).toBe("Proof");
  expect(lendMetadata.title).toBe("My lending");
  expect(shopMetadata.title).toBe("New order");
  expect(inboxMetadata.title).toBe("Inbox");
  expect(reportMetadata.title).toBe("Report");
  expect(notFoundMetadata.title).toBe("Page not found");
});
