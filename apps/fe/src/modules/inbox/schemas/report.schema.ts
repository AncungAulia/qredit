import { z } from "zod";
import { formatCount } from "@/lib/format";

// The report the hosted agents seal: one envelope for every service (`reportSchema`) with a `facts` object
// whose shape depends on the service. Each service has its own facts schema below; the shapes follow what the
// agent code writes (the service modules of the engine), so a field this app does not know is shown as a plain
// row and never dropped or dumped as raw data.

const verdictSchema = z.object({ label: z.string(), rule: z.string() });

export const reportSchema = z.object({
  v: z.literal(1),
  business: z.string(),
  vault: z.string().optional(),
  orderId: z.string().optional(),
  serviceId: z.number().int().optional(),
  subject: z.string().optional(),
  verdict: verdictSchema,
  facts: z.record(z.string(), z.unknown()),
  findings: z.array(z.string()),
  summary: z.string(),
  notes: z.array(z.string()).default([]),
  notice: z.string().optional(),
  generatedBy: z.string(),
  suppliers: z.array(z.object({ role: z.string(), amount: z.string() })).default([]),
  createdAt: z.string().transform((s) => new Date(s)),
});
export type Report = z.infer<typeof reportSchema>;

export type FactRow = { label: string; value: string };

const nullableText = z.string().nullish();

const counterpartyFacts = z.object({
  address: z.object({ bech32: z.string(), hex: z.string() }),
  listed: z.boolean(),
  listEntry: nullableText,
  list: z.string(),
  mldsaRegistered: z.boolean(),
  possessionProven: z.boolean(),
  keyType: nullableText,
  windowLive: z.boolean(),
  windowOpenToAny: z.boolean(),
  exists: z.boolean(),
  txSent: z.number(),
  classicalKeyExposed: z.boolean(),
});

const sanctionsFacts = z.object({
  list: z.string(),
  checked: z.array(z.string()),
  checkedCount: z.number(),
  matches: z.array(z.object({ address: z.string(), entry: z.string() })),
  matchCount: z.number(),
});

const bytecodeShape = {
  address: z.string(),
  isContract: z.boolean(),
  codeSize: z.number(),
  erc20Selectors: z.array(z.string()),
  usesPqcVerify: z.boolean(),
  usesPqcKeyStatus: z.boolean(),
  usesPqcPrecompile: z.boolean(),
  ecrecoverHint: z.boolean(),
  deep: z.boolean(),
  token: z
    .object({ name: nullableText, symbol: nullableText, decimals: z.number().nullish(), totalSupply: nullableText })
    .optional(),
  owner: nullableText,
  ownerPresent: z.boolean(),
};
const contractAuditorFacts = z.object(bytecodeShape);
const dueDiligenceFacts = z.object({
  ...bytecodeShape,
  listed: z.boolean(),
  listEntry: nullableText,
  list: nullableText,
});

const yesNo = (v: boolean) => (v ? "Yes" : "No");
const row = (label: string, value: string): FactRow => ({ label, value });

function bytecodeRows(f: z.infer<typeof contractAuditorFacts>): FactRow[] {
  const rows = [row("Contract code found", yesNo(f.isContract))];
  if (f.isContract) rows.push(row("Code size", `${formatCount(f.codeSize)} bytes`));
  rows.push(
    row("Calls the pqcVerify precompile", yesNo(f.usesPqcVerify)),
    row("Calls the pqcKeyStatus precompile", yesNo(f.usesPqcKeyStatus)),
    row("ecrecover call pattern (heuristic)", yesNo(f.ecrecoverHint)),
    row("ERC-20 functions in code", f.erc20Selectors.length ? f.erc20Selectors.join(", ") : "None"),
  );
  if (f.token) {
    const t = f.token;
    rows.push(
      row("Token", `${t.name ?? "unknown"} (${t.symbol ?? "unknown"}), ${t.decimals ?? "unknown"} decimals, total supply ${t.totalSupply ?? "unknown"}`),
    );
  }
  if (f.deep) rows.push(row("Owner", f.owner ?? "None"));
  return rows;
}

const keyStatus = (f: z.infer<typeof counterpartyFacts>) =>
  f.mldsaRegistered ? (f.possessionProven ? "Registered and proven" : "Registered, not proven") : "Not registered";

type Service = {
  schema: z.ZodObject<z.ZodRawShape>;
  rows(facts: never): FactRow[];
  keyFacts?(facts: never): FactRow[];
  graded?: boolean;
};

const service = <S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  rows: (f: z.infer<S>) => FactRow[],
  extra: { keyFacts?: (f: z.infer<S>) => FactRow[]; graded?: boolean } = {},
): Service => ({ schema, rows: rows as Service["rows"], keyFacts: extra.keyFacts as Service["keyFacts"], graded: extra.graded });

const SERVICES: Record<string, Service> = {
  "counterparty-check": service(
    counterpartyFacts,
    (f) => [
      row("Account has on-chain history", yesNo(f.exists)),
      row("Transactions sent", formatCount(f.txSent)),
      row("Post-quantum key registered", yesNo(f.mldsaRegistered)),
      ...(f.mldsaRegistered ? [row("Key possession proven", yesNo(f.possessionProven))] : []),
      ...(f.keyType ? [row("Key type", f.keyType)] : []),
      row("Classical key exposed on chain", yesNo(f.classicalKeyExposed)),
      row("Flag list", f.list),
      row("Listed on the flag list", yesNo(f.listed)),
      row("Live EVM window", yesNo(f.windowLive)),
      row("Live EVM window open to any target", yesNo(f.windowOpenToAny)),
      row("Address (hex)", f.address.hex),
      row("Address (bech32)", f.address.bech32),
    ],
    {
      graded: true,
      keyFacts: (f) => [
        row("Transactions sent", formatCount(f.txSent)),
        row("Post-quantum key", keyStatus(f)),
        row("Flag list", f.listed ? `Listed: ${f.listEntry ?? "no entry text"}` : "Not listed"),
      ],
    },
  ),
  "sanctions-screen": service(sanctionsFacts, (f) => [
    row("Sanctions list", f.list),
    row("Addresses checked", formatCount(f.checkedCount)),
    row("Checked addresses", f.checked.join(", ") || "None"),
    row(
      "Matches",
      f.matchCount === 0 ? "None" : `${formatCount(f.matchCount)}: ${f.matches.map((m) => `${m.address} (${m.entry})`).join(", ")}`,
    ),
  ]),
  "due-diligence": service(dueDiligenceFacts, (f) => [
    ...bytecodeRows(f),
    row("Flag list", f.list ?? "None"),
    row("Listed on the flag list", yesNo(f.listed)),
    ...(f.listed ? [row("Flag list entry", f.listEntry ?? "No entry text")] : []),
  ]),
  "contract-auditor": service(contractAuditorFacts, bytecodeRows),
};

/** "newSignal" becomes "New signal". */
function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Any value as plain text: no braces, quotes or brackets. */
function describeValue(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return yesNo(v);
  if (typeof v === "number") return formatCount(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length ? v.map(describeValue).join(", ") : "None";
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return entries.length ? entries.map(([k, x]) => `${k}: ${describeValue(x)}`).join("; ") : "None";
  }
  return String(v);
}

const plainRows = (values: Record<string, unknown>, skip: ReadonlySet<string>): FactRow[] =>
  Object.entries(values)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => row(humanize(k), describeValue(v)));

export type ParsedReport = {
  report: Report;
  /** A letter A to F for the service that grades, otherwise null. */
  grade: string | null;
  keyFacts: FactRow[];
  /** Every fact of a known service, with a readable label. */
  facts: FactRow[];
  /** Fields this app does not know, as plain rows. */
  extras: FactRow[];
};

/** A decrypted report as rows to show; null when it is not a report this app can read. */
export function parseReport(raw: unknown): ParsedReport | null {
  const base = reportSchema.safeParse(raw);
  if (!base.success) return null;
  const report = base.data;
  const known = SERVICES[report.business];
  const facts = known ? known.schema.safeParse(report.facts) : null;
  const understood = known && facts?.success ? { known, data: facts.data } : null;

  const factKeys = new Set(understood ? Object.keys(known!.schema.shape) : []);
  const topKeys = new Set(Object.keys(reportSchema.shape));
  const extras = [
    ...plainRows(report.facts, factKeys),
    ...plainRows(raw as Record<string, unknown>, topKeys),
  ];
  return {
    report,
    grade: known?.graded && /^[A-F]$/.test(report.verdict.label) ? report.verdict.label : null,
    keyFacts: understood?.known.keyFacts?.(understood.data as never) ?? [],
    facts: understood?.known.rows(understood.data as never) ?? [],
    extras,
  };
}
