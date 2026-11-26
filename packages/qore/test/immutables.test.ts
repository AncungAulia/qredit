import { expect, test } from "bun:test";
import { fillImmutables } from "../scripts/immutables.ts";

const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";

test("writes the padded value into every immutable slot", () => {
  const code = `0x${"00".repeat(70)}` as const;
  const out = fillImmutables(code, { "1": [{ start: 2, length: 32 }], "2": [{ start: 36, length: 32 }] }, FUSD);
  const word = `${"00".repeat(12)}${FUSD.slice(2).toLowerCase()}`;
  expect(out.slice(2 + 4, 2 + 4 + 64)).toBe(word);
  expect(out.slice(2 + 72, 2 + 72 + 64)).toBe(word);
  expect(out.length).toBe(2 + 140);
});

test("refuses a slot that is not one word or runs past the code", () => {
  expect(() => fillImmutables("0x0000", { "1": [{ start: 0, length: 20 }] }, FUSD)).toThrow("bad immutable slot");
  expect(() => fillImmutables("0x0000", { "1": [{ start: 0, length: 32 }] }, FUSD)).toThrow("bad immutable slot");
});
