import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function keystore(dir: string) {
  const file = (name: string) => {
    if (!NAME.test(name)) throw new Error(`invalid key name "${name}"`);
    return join(dir, `${name}.json`);
  };
  return {
    has: (name: string) => existsSync(file(name)),
    read: (name: string): Record<string, string> => JSON.parse(readFileSync(file(name), "utf8")),
    write: (name: string, data: Record<string, string>) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(name), JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
    },
    list: () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : []),
  };
}
export type Keystore = ReturnType<typeof keystore>;
