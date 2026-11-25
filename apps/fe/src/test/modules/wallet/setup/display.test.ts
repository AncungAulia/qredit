import { expect, test } from "vitest";
import { setupDisplay } from "@/modules/wallet/setup/display";
import type { SetupStatus } from "@/modules/wallet/setup/steps";

const status = (s: Partial<SetupStatus>): SetupStatus => ({
  fund: "todo",
  registerKey: "waiting",
  convert: "waiting",
  registerKem: "waiting",
  publishCard: "waiting",
  ...s,
});

test("the first unfinished step is next, the rest wait", () => {
  expect(setupDisplay(status({ fund: "done", registerKey: "todo" }))).toEqual({
    fund: "done",
    registerKey: "next",
    convert: "waiting",
    registerKem: "waiting",
    publishCard: "waiting",
  });
});

test("a step that is done on chain still waits while an earlier step is not done", () => {
  // The card is published but the faucet step is not done: nothing after the first gap is a tick.
  const shown = setupDisplay(status({ fund: "todo", registerKey: "done", convert: "done", registerKem: "done", publishCard: "done" }));
  expect(shown.fund).toBe("next");
  expect(shown.registerKey).toBe("waiting");
  expect(shown.publishCard).toBe("waiting");
});

test("every step done", () => {
  const all = status({ fund: "done", registerKey: "done", convert: "done", registerKem: "done", publishCard: "done" });
  expect(Object.values(setupDisplay(all))).toEqual(["done", "done", "done", "done", "done"]);
});
