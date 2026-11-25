import { ShieldCheck } from "lucide-react";
import { KpiTile } from "@/components/shared/KpiTile";
import { TxLink } from "@/components/shared/TxLink";
import { ATTACKS, type Attack } from "@/config/attacks";
import { formatCount, shortHash } from "@/lib/format";

function Proof({ tx }: { tx: Attack["txHash"] }) {
  if (!tx) return <span className="text-[13px] text-text-tertiary">Not recorded yet</span>;
  if (tx.kind === "evm") return <TxLink hash={tx.hash} compact />;
  return (
    <span title={tx.hash} className="font-mono text-[13px] text-text-secondary">
      {shortHash(tx.hash)}
    </span>
  );
}

/** Card/Attack in the design: what was tried, what refused it and the transaction that shows it. */
function AttackCard({ attack }: { attack: Attack }) {
  const Icon = attack.icon;
  return (
    <li className="flex h-full flex-col gap-3.5 rounded-3xl bg-surface p-5 md:p-[22px]">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-danger-soft text-danger">
          <Icon className="size-[17px]" aria-hidden />
        </span>
        <h2 className="min-w-0 flex-1 text-base leading-snug font-medium text-text-primary">
          {attack.title}
        </h2>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-tertiary">What was tried</span>
        <p className="text-sm leading-[1.45] text-text-primary">{attack.tried}</p>
      </div>
      <div className="flex gap-2.5 rounded-xl bg-surface-muted p-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-strong" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-text-tertiary">What refused it</span>
          <p className="text-[13px] leading-[1.45] text-text-secondary">{attack.stoppedBy}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center pt-0.5">
        <Proof tx={attack.txHash} />
      </div>
    </li>
  );
}

/** The attacks of the security model, each with the recorded transaction that shows it being stopped, when one exists. */
export function AttackList() {
  const recorded = ATTACKS.filter((a) => a.txHash !== null).length;
  return (
    <div className="flex animate-in flex-col gap-4 duration-200 fade-in md:gap-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <KpiTile variant="feature" label="Attacks listed" value={formatCount(ATTACKS.length)} />
        <KpiTile
          variant="soft"
          label="With a recorded transaction"
          value={formatCount(recorded)}
          unit={`of ${formatCount(ATTACKS.length)}`}
        />
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        {ATTACKS.map((a) => (
          <AttackCard key={a.id} attack={a} />
        ))}
      </ul>
    </div>
  );
}
