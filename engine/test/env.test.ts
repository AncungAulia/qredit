import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertEnv } from "../src/setup/env.ts";

const tmp = () => join(mkdtempSync(join(tmpdir(), "qredit-env-")), ".env");

describe("upsertEnv", () => {
  test("replaces every key form in place and appends new keys", () => {
    const p = tmp();
    writeFileSync(p, "A=1\nexport B=2\nC = 3\nKEEP=x\n");
    upsertEnv(p, { A: "9", B: "8", C: "7", D: "6" });
    expect(readFileSync(p, "utf8")).toBe("A=9\nB=8\nC=7\nKEEP=x\nD=6\n");
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });
  test("a file without a trailing newline does not merge lines", () => {
    const p = tmp();
    writeFileSync(p, "KEEP=x");
    upsertEnv(p, { A: "1" });
    expect(readFileSync(p, "utf8")).toBe("KEEP=x\nA=1\n");
  });
  test("preserves CRLF", () => {
    const p = tmp();
    writeFileSync(p, "A=1\r\nKEEP=x\r\n");
    upsertEnv(p, { A: "2", B: "3" });
    expect(readFileSync(p, "utf8")).toBe("A=2\r\nKEEP=x\r\nB=3\r\n");
  });
  test("creates a missing file and does not match longer key names", () => {
    const p = tmp();
    upsertEnv(p, { A: "1" });
    writeFileSync(p, "AB=5\n");
    upsertEnv(p, { A: "1" });
    expect(readFileSync(p, "utf8")).toBe("AB=5\nA=1\n");
  });
});
