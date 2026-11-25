import { expect, test } from "vitest";
import { isActive, isTopLevel } from "@/config/nav";

test("Market is active on the market and on business pages only", () => {
  expect(isActive("/", "/")).toBe(true);
  expect(isActive("/", "/agents/counterparty-check")).toBe(true);
  expect(isActive("/", "/lend")).toBe(false);
});

test("a section is active on its own path and below it, not on a similar prefix", () => {
  expect(isActive("/lend", "/lend")).toBe(true);
  expect(isActive("/lend", "/lend/0x1")).toBe(true);
  expect(isActive("/lend", "/lending")).toBe(false);
});

test("only the four section paths are top level", () => {
  for (const p of ["/", "/lend", "/inbox", "/proof"]) expect(isTopLevel(p)).toBe(true);
  expect(isTopLevel("/agents/x")).toBe(false);
  expect(isTopLevel("/lend/0x1")).toBe(false);
});
