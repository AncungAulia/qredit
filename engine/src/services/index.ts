import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contractAuditor } from "./contract-auditor.ts";
import { counterparty } from "./counterparty.ts";
import { dueDiligence } from "./due-diligence.ts";
import { sanctions } from "./sanctions.ts";
import type { ServiceDef, ServiceModule } from "./types.ts";

const load = (def: ServiceDef): ServiceModule => ({
  ...def,
  skill: readFileSync(join(import.meta.dir, "../../skills", def.slug, "SKILL.md"), "utf8"),
});

/** Keyed by business slug. */
export const SERVICES: Record<string, ServiceModule> = Object.fromEntries(
  [counterparty, sanctions, dueDiligence, contractAuditor].map((d) => [d.slug, load(d)]),
);
export type { ServiceModule } from "./types.ts";
