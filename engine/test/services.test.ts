import { describe, expect, test } from "bun:test";
import { SERVICES } from "../src/services/index.ts";

const HEX = "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9";
const BECH = "qor1fpl5f8pp5j82l8fwkwqy75galdm3tm4feknkpz";
const HEX2 = "0x" + "11".repeat(20);
const HEX3 = "0x" + "22".repeat(20);

const idx = (o: Record<string, unknown> = {}) => ({
  address: { bech32: "qor1x", hex: "0xab" }, exists: true, sequence: 3, publicKeyType: "eth_secp256k1", isContract: false,
  pq: { registered: true, possessionProven: true, keyType: "hybrid", window: { live: false, allowedTargets: [] } },
  flagged: { listed: false, entry: null, list: "qredit-synthetic-flags-v1" }, ...o,
});
const pq = (registered: boolean, proven: boolean, live: boolean, allowedTargets: string[]) =>
  ({ registered, possessionProven: proven, keyType: registered ? "hybrid" : null, window: { live, allowedTargets } });

const code = (o: Record<string, unknown> = {}) => ({
  address: HEX, isContract: true, codeSize: 100, erc20Selectors: [], usesPqcVerify: false, usesPqcKeyStatus: false, ecrecoverHint: false, ...o,
});
const deep = (o: Record<string, unknown> = {}, owner: string | null = null) => ({
  ...code(o), token: { name: "T", symbol: "T", decimals: 18, totalSupply: "1000" }, owner,
});

describe("loading", () => {
  test("four services, each with a skill and the expected headings", () => {
    expect(Object.keys(SERVICES).sort()).toEqual(["contract-auditor", "counterparty-check", "due-diligence", "sanctions-screen"]);
    for (const s of Object.values(SERVICES)) {
      for (const h of ["## Scope", "## Input", "## Suppliers", "## Verdict rules", "## Tone"]) expect(s.skill).toContain(h);
    }
  });
});

describe("counterparty-check", () => {
  const s = SERVICES["counterparty-check"]!;
  const grade = (d: unknown) => s.verdict(s.facts({ address: "0xab" }, { dataIndexer: d })).label;
  test("suppliers", () => expect(s.suppliers).toEqual({ required: ["dataIndexer"], choice: [] }));
  test("input: one address only", () => {
    const ok = s.parseInput(` ${BECH} `);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.query).toEqual({ address: HEX });
    expect(s.parseInput(HEX).ok).toBe(true);
    expect(s.parseInput("pay 0xevil now").ok).toBe(false);
    expect(s.parseInput(`${HEX} ${HEX}`).ok).toBe(false);
    expect(s.parseInput("").ok).toBe(false);
  });
  test("grade table, first match wins", () => {
    expect(grade(idx({ flagged: { listed: true, entry: "e", list: "l" }, pq: pq(false, false, true, []) }))).toBe("F");
    expect(grade(idx({ pq: pq(false, false, true, []) }))).toBe("D");
    expect(grade(idx({ pq: pq(false, false, true, ["0x1"]) }))).toBe("C");
    expect(grade(idx({ pq: pq(false, false, false, []) }))).toBe("C");
    expect(grade(idx({ pq: pq(true, false, false, []) }))).toBe("B");
    expect(grade(idx())).toBe("A");
  });
  test("findings come from code and the notice names the synthetic list", () => {
    const f = s.findings(s.facts({ address: "0xab" }, { dataIndexer: idx({ pq: pq(false, false, true, []) }) }));
    expect(f).toContain("ML-DSA-87 key registered: no.");
    expect(f).toContain("Live EVM window open to any target.");
    expect(s.notice).toMatch(/synthetic/i);
  });
  test("facts are plain JSON", () => {
    const facts = s.facts({ address: "0xab" }, { dataIndexer: idx() });
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });
  test("activity facts: txSent, exists, classicalKeyExposed", () => {
    const facts = s.facts({ address: "0xab" }, { dataIndexer: idx({ sequence: 3, publicKeyType: "eth_secp256k1" }) });
    expect(facts.txSent).toBe(3);
    expect(facts.exists).toBe(true);
    expect(facts.classicalKeyExposed).toBe(true);
    expect(s.facts({}, { dataIndexer: idx({ sequence: 0, publicKeyType: "eth_secp256k1" }) }).classicalKeyExposed).toBe(false);
    expect(s.facts({}, { dataIndexer: idx({ sequence: 2, publicKeyType: null }) }).classicalKeyExposed).toBe(false);
  });
  test("activity findings, including no-history line", () => {
    const f = s.findings(s.facts({}, { dataIndexer: idx({ sequence: 3, publicKeyType: "eth_secp256k1" }) }));
    expect(f).toContain("Transactions sent from this account: 3.");
    expect(f).toContain("Classical public key exposed on chain: yes.");
    expect(f.join(" ")).not.toContain("no on-chain history");
    const none = s.findings(s.facts({}, { dataIndexer: idx({ exists: false, sequence: 0, publicKeyType: null }) }));
    expect(none).toContain("Transactions sent from this account: 0.");
    expect(none).toContain("Classical public key exposed on chain: no.");
    expect(none).toContain("The account has no on-chain history.");
  });
  test("grade rules unchanged by activity facts", () => {
    expect(s.verdict(s.facts({}, { dataIndexer: idx({ sequence: 9, publicKeyType: "eth_secp256k1" }) })).label).toBe("A");
  });
});

describe("sanctions-screen", () => {
  const s = SERVICES["sanctions-screen"]!;
  const run = (matches: { address: string; entry: string }[], checked = [HEX]) =>
    s.verdict(s.facts({}, { listOracle: { list: "L", checked, matches } }));
  test("suppliers and notice", () => {
    expect(s.suppliers).toEqual({ required: ["listOracle"], choice: [] });
    expect(s.notice).toMatch(/synthetic/i);
  });
  test("input: one address, comma, whitespace and newline separators, dedupe", () => {
    const one = s.parseInput(BECH);
    expect(one.ok && one.query).toEqual({ addresses: HEX });
    const many = s.parseInput(`${HEX}, ${HEX2}\n${HEX3}  ${HEX2}`);
    expect(many.ok && many.query).toEqual({ addresses: [HEX, HEX2, HEX3].join(",") });
    if (many.ok) expect(many.subject).toBe("3 addresses");
  });
  test("input: 20 ok, 21 refused", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0")).join(",");
    expect(s.parseInput(mk(20)).ok).toBe(true);
    expect(s.parseInput(mk(21)).ok).toBe(false);
  });
  test("input: junk refused and named", () => {
    const r = s.parseInput(`${HEX}, 0xnope`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("0xnope");
    expect(s.parseInput("").ok).toBe(false);
  });
  test("verdict match / no match", () => {
    const m = run([{ address: HEX, entry: "bad actor" }], [HEX, HEX2]);
    expect(m.label).toBe("match");
    expect(m.rule).toBe("listed on L");
    expect(run([]).label).toBe("no match");
  });
  test("findings name the listed address", () => {
    const f = s.findings(s.facts({}, { listOracle: { list: "L", checked: [HEX, HEX2, HEX3], matches: [{ address: HEX2, entry: "x" }] } }));
    expect(f[0]).toContain("3 addresses");
    expect(f.join(" ")).toContain(HEX2);
  });
});

describe("due-diligence", () => {
  const s = SERVICES["due-diligence"]!;
  const v = (d: Record<string, unknown>, role: "computeBasic" | "computeDeep" = "computeBasic") =>
    s.verdict(s.facts({ address: HEX }, { dataIndexer: idx(), [role]: d })).label;
  test("suppliers", () => expect(s.suppliers).toEqual({ required: ["dataIndexer"], choice: ["computeBasic", "computeDeep"] }));
  test("input: one 0x or qor1 address", () => {
    const a = s.parseInput(BECH);
    expect(a.ok && a.query).toEqual({ address: HEX });
    expect(s.parseInput(`${HEX} ${HEX2}`).ok).toBe(false);
    expect(s.parseInput("some token").ok).toBe(false);
  });
  test("rule 1: not a contract is high", () => expect(v(code({ isContract: false, codeSize: 0 }))).toBe("high"));
  test("rule 2: ecrecover hint and no PQC use is high", () => expect(v(code({ ecrecoverHint: true }))).toBe("high"));
  test("rule 3: owner present and no PQC use is medium (deep)", () => {
    const facts = s.facts({}, { dataIndexer: idx(), computeDeep: deep({}, HEX2) });
    expect(facts.ownerPresent).toBe(true);
    expect(s.verdict(facts)).toEqual({ label: "medium", rule: "owner present and no PQC precompile use" });
  });
  test("rule 4: no PQC use is medium", () => {
    expect(v(code())).toBe("medium");
    expect(s.verdict(s.facts({}, { dataIndexer: idx(), computeBasic: code() })).rule).toBe("no PQC precompile use");
    expect(v(deep({}, null), "computeDeep")).toBe("medium");
  });
  test("rule 5: PQC use is low, even with an owner or ecrecover hint", () => {
    expect(v(code({ usesPqcVerify: true }))).toBe("low");
    expect(v(code({ usesPqcKeyStatus: true, ecrecoverHint: true }))).toBe("low");
    expect(v(deep({ usesPqcVerify: true }, HEX2), "computeDeep")).toBe("low");
  });
  test("flag list from indexer: listed is high and comes first", () => {
    const flagged = { listed: true, entry: "known bad", list: "qredit-synthetic-flags-v1" };
    const facts = s.facts({}, { dataIndexer: idx({ flagged }), computeBasic: code({ usesPqcVerify: true }) });
    expect(facts.listed).toBe(true);
    expect(facts.listEntry).toBe("known bad");
    expect(facts.list).toBe("qredit-synthetic-flags-v1");
    expect(s.verdict(facts)).toEqual({ label: "high", rule: "address is on the flag list" });
    expect(s.findings(facts)).toContain("Address is on the flag list qredit-synthetic-flags-v1: known bad.");
  });
  test("not listed: no flag finding, rule falls through", () => {
    const facts = s.facts({}, { dataIndexer: idx(), computeBasic: code({ usesPqcVerify: true }) });
    expect(facts.listed).toBe(false);
    expect(facts.listEntry).toBeNull();
    expect(s.verdict(facts).label).toBe("low");
    expect(s.findings(facts).join(" ")).not.toContain("flag list");
  });
  test("absent indexer data means not listed", () => {
    const facts = s.facts({}, { computeBasic: code({ usesPqcVerify: true }) });
    expect(facts.listed).toBe(false);
    expect(facts.listEntry).toBeNull();
    expect(facts.list).toBeNull();
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });
  test("owner never counts for basic data", () => {
    expect(s.facts({}, { dataIndexer: idx(), computeBasic: code() }).ownerPresent).toBe(false);
  });
  test("findings include token and owner for deep", () => {
    const f = s.findings(s.facts({}, { dataIndexer: idx(), computeDeep: deep({}, HEX2) }));
    expect(f.join(" ")).toContain("Token name T");
    expect(f.join(" ")).toContain(HEX2);
    const facts = s.facts({}, { dataIndexer: idx(), computeDeep: deep() });
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });
});

describe("contract-auditor", () => {
  const s = SERVICES["contract-auditor"]!;
  const v = (d: Record<string, unknown>) => s.verdict(s.facts({ address: HEX }, { computeBasic: d })).label;
  test("suppliers", () => expect(s.suppliers).toEqual({ required: [], choice: ["computeBasic", "computeDeep"] }));
  test("input: one contract address", () => {
    expect(s.parseInput(HEX).ok).toBe(true);
    expect(s.parseInput(`${HEX},${HEX2}`).ok).toBe(false);
    expect(s.parseInput("hello").ok).toBe(false);
  });
  test("verdict table", () => {
    expect(v(code({ isContract: false, codeSize: 0, usesPqcVerify: true }))).toBe("not a contract");
    expect(v(code({ usesPqcVerify: true }))).toBe("pq-ready");
    expect(v(code({ usesPqcKeyStatus: true, ecrecoverHint: true }))).toBe("partial");
    expect(v(code({ ecrecoverHint: true }))).toBe("not ready");
    expect(v(code())).toBe("not ready");
  });
  test("deep data gives the same verdict and is merged", () => {
    const facts = s.facts({}, { computeDeep: deep({ usesPqcVerify: true }, HEX2) });
    expect(s.verdict(facts).label).toBe("pq-ready");
    expect(facts.owner).toBe(HEX2);
  });
  test("findings and no notice", () => {
    const f = s.findings(s.facts({}, { computeBasic: code({ usesPqcVerify: true }) }));
    expect(f.join(" ")).toContain("pqcVerify");
    expect(s.notice).toBeUndefined();
  });
});
