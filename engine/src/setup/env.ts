import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const escape = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Set KEY=value lines in an env file: replaces `KEY=`, `export KEY=` and `KEY =` forms in place (dropping duplicates),
 * appends missing keys, keeps the file's line endings, and writes via a temp file + rename so a crash cannot truncate it.
 */
export function upsertEnv(path: string, entries: Record<string, string>): void {
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const pending = new Map(Object.entries(entries));
  const out: string[] = [];
  for (const line of lines) {
    const key = Object.keys(entries).find((k) => new RegExp(`^\\s*(export\\s+)?${escape(k)}\\s*=`).test(line));
    if (!key) out.push(line);
    else if (pending.has(key)) {
      out.push(`${key}=${pending.get(key)}`);
      pending.delete(key);
    }
  }
  for (const [k, v] of pending) out.push(`${k}=${v}`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, out.join(eol) + eol, { mode: 0o600 });
  renameSync(tmp, path);
}
