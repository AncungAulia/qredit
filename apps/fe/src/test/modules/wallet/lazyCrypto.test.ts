import { readFileSync } from "node:fs";
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
