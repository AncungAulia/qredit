import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// The post-quantum key derivation is large. Only the code that signs may pull it in, and only when it runs.
const WALLET = join(__dirname, "../../../modules/wallet");
const HEAVY = ["deriveUnifiedAccount", "deriveSealKeys", "validateMnemonic", "generateMnemonic"];

const staticImports = (file: string) =>
  readFileSync(join(WALLET, file), "utf8")
    .split("\n")
    .filter((line) => /^import\s/.test(line) && !/^import\s+type\s/.test(line));

test.each(["session.ts", "components/CreateWalletForm.tsx", "schemas/walletForms.schema.ts"])(
  "%s does not import the key derivation at the top of the module",
  (file) => {
    for (const line of staticImports(file)) {
      for (const name of HEAVY) expect(line, `${file}: ${line}`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  },
);

test("the heavy modules are still loaded on demand where they are used", () => {
  const read = (f: string) => readFileSync(join(WALLET, f), "utf8");
  expect(read("session.ts")).toMatch(/import\("@qorechain\/sdk"\)/);
  expect(read("session.ts")).toMatch(/import\("@qorechain\/qoreseal"\)/);
  expect(read("components/CreateWalletForm.tsx")).toMatch(/import\("@qorechain\/sdk"\)/);
  expect(read("schemas/walletForms.schema.ts")).toMatch(/import\("@qorechain\/sdk"\)/);
});

// Whole app: a static value import of the barrel or of a heavy subpath puts the post-quantum code on every page.
const APP_ROOTS = [join(__dirname, "../../../../src"), join(__dirname, "../../../../app")];
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "test" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
const FILES = APP_ROOTS.flatMap(sources);
// Matches `import {...} from "x"` and `export ... from "x"` that are not type-only.
const valueImports = (text: string) =>
  [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!);

test("no file imports the @qredit/qore barrel as a value", () => {
  const offenders = FILES.filter((f) => valueImports(readFileSync(f, "utf8")).includes("@qredit/qore"));
  expect(offenders).toEqual([]);
});

test("no file imports a heavy @qredit/qore subpath or a post-quantum package statically as a value", () => {
  const heavy = /^@qredit\/qore\/(tx|buyer|seal|keys|erc20|relayed)$|^@qorechain\/(sdk|qoreseal|evm)(\/.*)?$/;
  const offenders = FILES.flatMap((f) => valueImports(readFileSync(f, "utf8")).filter((s) => heavy.test(s)).map((s) => `${f}: ${s}`));
  expect(offenders).toEqual([]);
});
