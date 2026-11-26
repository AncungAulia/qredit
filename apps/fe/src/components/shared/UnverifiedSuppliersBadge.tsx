import { ShieldAlert } from "lucide-react";

/** Badge/Warning: a listed supplier is not in Qredit's supplier list, so it could be an address the owner controls. */
export function UnverifiedSuppliersBadge() {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1.5 text-[13px] leading-none font-medium text-warning">
      <ShieldAlert className="size-3.5" aria-hidden />
      Unverified suppliers
    </span>
  );
}
