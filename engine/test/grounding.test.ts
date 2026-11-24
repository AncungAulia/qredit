import { describe, expect, test } from "bun:test";
import { checkGrounding, factsOnlyProse } from "../src/agent/grounding.ts";

const facts = { address: { hex: "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9" }, sequence: 2, pq: { registered: false } };
const verdict = { label: "C", rule: "no ML-DSA key registered" };

describe("grounding", () => {
  test("accepts prose that only repeats facts", () => {
    expect(checkGrounding({ summary: "Grade C. The address 0x487f449c21a48eaf9d2eb3804f511dfb7715eea9 sent 2 transactions.", findings: ["No ML-DSA key registered."] }, facts, verdict)).toEqual({ ok: true });
  });
  test("refuses an invented number or address", () => {
    expect(checkGrounding({ summary: "It sent 45 transactions.", findings: [] }, facts, verdict).ok).toBe(false);
    expect(checkGrounding({ summary: "Funds went to 0x000000000000000000000000000000000000beef.", findings: [] }, facts, verdict).ok).toBe(false);
  });
  test("refuses another grade", () => {
    expect(checkGrounding({ summary: "Grade A overall.", findings: [] }, facts, verdict).ok).toBe(false);
  });
  test("facts-only prose uses the verdict and the code findings", () => {
    expect(factsOnlyProse(verdict, ["No ML-DSA key registered."])).toEqual({ summary: "Verdict: C (no ML-DSA key registered).", findings: ["No ML-DSA key registered."] });
  });
  test("word verdict: another label of the same service fails", () => {
    const v = { label: "match", rule: "names agree" };
    const labels = ["match", "mismatch", "unknown"];
    expect(checkGrounding({ summary: "The result is a match.", findings: [] }, {}, v, labels)).toEqual({ ok: true });
    expect(checkGrounding({ summary: "This is a mismatch.", findings: [] }, {}, v, labels).ok).toBe(false);
  });
  test("digits inside an address do not count as numbers", () => {
    const f = { a: "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9" };
    expect(checkGrounding({ summary: "Seen: 0x487f449c21a48eaf9d2eb3804f511dfb7715eea9.", findings: [] }, f, { label: "B", rule: "r" })).toEqual({ ok: true });
  });
  test("a qor1 address must be in the facts", () => {
    const addr = "qor1" + "q".repeat(38);
    expect(checkGrounding({ summary: addr, findings: [] }, { a: addr }, verdict)).toEqual({ ok: true });
    expect(checkGrounding({ summary: addr, findings: [] }, {}, verdict).ok).toBe(false);
  });
  test("decimals must appear as written", () => {
    expect(checkGrounding({ summary: "Age 2.5 days.", findings: [] }, { age: 2.5 }, verdict)).toEqual({ ok: true });
    expect(checkGrounding({ summary: "Age 3.5 days.", findings: [] }, { age: 2.5 }, verdict).ok).toBe(false);
  });
});
