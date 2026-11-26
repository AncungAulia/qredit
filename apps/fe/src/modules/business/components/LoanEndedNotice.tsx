import { Notice } from "@/components/shared/Notice";
import { formatFusd } from "@/lib/format";
import type { VaultSnapshot } from "@/modules/market";

/** The danger notice of a business whose loan ended: defaulted by anyone, or closed by the owner. */
export function LoanEndedNotice({ vault }: { vault: Pick<VaultSnapshot, "state" | "swept"> }) {
  const title = vault.state === "Closed" ? "The owner closed this business" : "This loan defaulted";
  return (
    <Notice tone="danger" title={title}>
      {`The vault stopped selling and paying suppliers. ${formatFusd(vault.swept)} from its cash, the owner's unclaimed share and the bond went to lenders, who claim it in My lending.`}
    </Notice>
  );
}
