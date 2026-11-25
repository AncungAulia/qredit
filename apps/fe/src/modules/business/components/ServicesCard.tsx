import { formatFusd } from "@/lib/format";
import type { Business } from "@/lib/schemas";

/** What the business sells (ServiceCard in the design). Buying arrives with the order flow. */
export function ServicesCard({ services }: { services: Business["services"] }) {
  if (services.length === 0) {
    return (
      <div className="rounded-3xl bg-surface p-6">
        <p className="text-sm text-text-secondary">This business has not listed a service.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {services.map((s) => (
        <li
          key={s.id}
          className="flex items-center justify-between gap-4 rounded-3xl bg-surface p-6"
        >
          <span className="min-w-0 text-[15px] font-medium text-text-primary">{s.name}</span>
          <span className="shrink-0 text-[15px] font-medium text-text-primary tabular-nums">
            {formatFusd(s.priceUnits)}
          </span>
        </li>
      ))}
    </ul>
  );
}
