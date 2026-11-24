import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeployments, writeDeployment } from "../src/setup/deployments.ts";

describe("deployments.json", () => {
  test("missing file reads as empty; writes merge by slug", () => {
    const path = join(mkdtempSync(join(tmpdir(), "qredit-dep-")), "deployments.json");
    expect(readDeployments(path)).toEqual({});
    const d = { slug: "a", vault: "0x1", startBlock: 5, createTx: "0xc", spender: "0x2", operator: "0x3", agentPubkey: "ab", linkTx: "", windowTx: "" };
    writeDeployment(d, path);
    writeDeployment({ ...d, slug: "b", vault: "0x9" }, path);
    writeDeployment({ ...d, linkTx: "0xl" }, path);
    const all = readDeployments(path);
    expect(Object.keys(all)).toEqual(["a", "b"]);
    expect(all.a.linkTx).toBe("0xl");
  });
});
