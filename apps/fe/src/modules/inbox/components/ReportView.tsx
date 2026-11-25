import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { Address } from "@/components/shared/Address";
import { Notice } from "@/components/shared/Notice";
import { formatDateTime } from "@/lib/format";
import { RiskDial } from "@/modules/inbox/components/RiskDial";
import type { FactRow, ParsedReport } from "@/modules/inbox/schemas/report.schema";

const CARD = "flex min-w-0 flex-col gap-3 rounded-3xl bg-surface p-5 md:p-6";

function CardHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-medium text-text-primary">{title}</h2>
      <p className="text-[13px] text-text-tertiary">{sub}</p>
    </div>
  );
}

/** Rows of label and value as a definition list. Long values wrap, and nothing is cut. */
function Rows({ rows }: { rows: FactRow[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <dt className="text-sm text-text-secondary sm:flex-1">{r.label}</dt>
          <dd className="min-w-0 text-sm font-medium [overflow-wrap:anywhere] text-text-primary tabular-nums sm:max-w-[60%] sm:text-right">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const isEvmAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

function Verdict({ parsed }: { parsed: ParsedReport }) {
  const { report, grade, keyFacts } = parsed;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 rounded-3xl bg-surface p-5 md:p-6">
      <div className="flex flex-col gap-2.5">
        <span className="text-[13px] text-text-tertiary">{grade ? "Risk grade for" : "Report for"}</span>
        {report.subject &&
          (isEvmAddress(report.subject) ? <Address value={report.subject} className="w-fit" /> : <span className="text-sm font-medium break-words text-text-primary">{report.subject}</span>)}
        {!grade && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            <span className="rounded-full bg-accent-soft px-2.5 py-1.5 text-[13px] leading-none font-medium text-accent-strong">{report.verdict.label}</span>
            {report.verdict.rule}
          </p>
        )}
        <p className="text-[17px] leading-normal text-text-primary">{report.summary}</p>
      </div>
      {keyFacts.length > 0 && (
        <ul className="grid gap-2.5 md:grid-cols-3">
          {keyFacts.map((f) => (
            <li key={f.label} className="flex flex-col gap-1 rounded-xl bg-surface-muted p-3.5">
              <span className="text-[13px] text-text-tertiary">{f.label}</span>
              <span className="text-[15px] font-medium text-text-primary tabular-nums">{f.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Findings({ parsed }: { parsed: ParsedReport }) {
  const { report } = parsed;
  const model = report.generatedBy === "facts-only" ? null : report.generatedBy;
  const list = (items: string[]): ReactNode => (
    <ul className="flex flex-col gap-3">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-px grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <CircleCheck className="size-3.5" aria-hidden />
          </span>
          <span className="text-sm leading-normal text-text-secondary">{t}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-labelledby="findings" className={CARD}>
      <div className="flex flex-col gap-1">
        <h2 id="findings" className="text-lg font-medium text-text-primary">
          Findings
        </h2>
        <p className="text-[13px] text-text-tertiary">Computed by the agent&apos;s code from the facts.</p>
      </div>
      {report.findings.length > 0 ? list(report.findings) : <p className="text-sm text-text-secondary">This report lists no findings.</p>}
      {report.notes.length > 0 && (
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-[13px] text-text-tertiary">
            {model ? `Notes written by ${model} and checked against the facts before sealing.` : "Notes taken from the facts by the agent's code."}
          </p>
          {list(report.notes)}
        </div>
      )}
    </section>
  );
}

/** The opened report of one service: the grade or verdict, the facts, the findings and any field this page does not know as plain rows. */
export function ReportView({ parsed }: { parsed: ParsedReport }) {
  const { report, grade, facts, extras } = parsed;
  const details: FactRow[] = [
    { label: "Written by", value: report.generatedBy === "facts-only" ? "The agent's code only" : report.generatedBy },
    { label: "Created", value: formatDateTime(report.createdAt) },
  ];
  return (
    <div className="flex flex-col gap-4">
      {report.notice && <Notice tone="warning">{report.notice}</Notice>}
      <div className="flex flex-col gap-4 lg:flex-row">
        {grade && (
          <div className="flex flex-col gap-3 rounded-3xl bg-surface p-5 md:p-6 lg:w-[340px] lg:shrink-0">
            <CardHead title="Risk grade" sub="From A, the lowest risk, to F." />
            <RiskDial grade={grade} />
          </div>
        )}
        <Verdict parsed={parsed} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="facts" className={CARD}>
          <div className="flex flex-col gap-1">
            <h2 id="facts" className="text-lg font-medium text-text-primary">
              All facts
            </h2>
            <p className="text-[13px] text-text-tertiary">Computed by the agent&apos;s code from chain data.</p>
          </div>
          <Rows rows={[...facts, ...extras, ...details]} />
        </section>
        <Findings parsed={parsed} />
      </div>
    </div>
  );
}
