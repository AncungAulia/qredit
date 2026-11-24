import { describe, expect, test } from "bun:test";
import { agentVars, apiVars, describeVars, diffVars, exampleKeys, parseEnv, suppliersVars, tail } from "./lib.ts";

describe("parseEnv", () => {
  test("drops comments, blanks and empty values; strips quotes; keeps = inside values", () => {
    expect(parseEnv('# c\nA=1\n\nB=\nC="x=y"\r\nD=\'q\'\n bad line\n')).toEqual({ A: "1", C: "x=y", D: "q" });
  });
  test("keeps JSON values intact", () => {
    expect(parseEnv('OPERATOR_KEYS=[{"privateKey":"0x1"}]')).toEqual({ OPERATOR_KEYS: '[{"privateKey":"0x1"}]' });
  });
});

describe("exampleKeys", () => {
  test("lists active names only", () => {
    expect(exampleKeys("# X=1\nA=\nPORT=8787\n# B=2")).toEqual(["A", "PORT"]);
  });
});

const be = { DATABASE_URL: "d", ENGINE_TOKEN: "t", IP_SALT: "s", RELAYER_KEY: "r", TREASURY_KEY: "k", OPERATOR_KEYS: "[]", PORT: "9", GEMINI_API_KEY: "g", CORS_ORIGINS: "c" };
const allowed = ["DATABASE_URL", "ENGINE_TOKEN", "IP_SALT", "RELAYER_KEY", "TREASURY_KEY", "OPERATOR_KEYS", "PORT", "CORS_ORIGINS"];

describe("service variables", () => {
  test("api: allow-list only, fixed PORT, one proxy hop", () => {
    const v = apiVars(be, allowed);
    expect(v.GEMINI_API_KEY).toBeUndefined();
    expect(v.PORT).toBe("8787");
    expect(v.TRUSTED_PROXY_HOPS).toBe("1");
    expect(v.CORS_ORIGINS).toBe("c");
  });
  test("api: missing required names are reported by name", () => {
    expect(() => apiVars({ ...be, IP_SALT: "" }, allowed)).toThrow("IP_SALT");
  });
  test("suppliers and agent point at private URLs", () => {
    const e = { OWNER_ADDRESS: "0xa", ENGINE_TOKEN: "t", OPENROUTER_API_KEY: "o" };
    expect(suppliersVars(e).API_URL).toBe("http://api.railway.internal:8787");
    const a = agentVars(e, "{}");
    expect(a.SUPPLIERS_URL).toBe("http://suppliers.railway.internal:8788");
    expect(a.ENGINE_KEYS_JSON).toBe("{}");
    expect(() => agentVars({ OWNER_ADDRESS: "0xa", ENGINE_TOKEN: "t" }, "{}")).toThrow("OPENROUTER_API_KEY");
  });
});

describe("output helpers", () => {
  test("describeVars never contains values", () => {
    const out = describeVars("api", { SECRET: "hunter2hunter2" }).join("\n");
    expect(out).toBe("api: SECRET (len 14)");
    expect(out).not.toContain("hunter2");
  });
  test("diffVars", () => {
    expect(diffVars({ A: "1", B: "2" }, { A: "1", B: "3", C: "4" })).toEqual({ add: ["C"], change: ["B"], same: ["A"] });
  });
  test("tail", () => {
    expect(tail(["a", "b", "c"], 2)).toEqual(["b", "c"]);
  });
});
