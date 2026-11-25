import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/PageStates";
import { ReportPage } from "@/modules/inbox";

export const metadata = { title: "Report" };

const VAULT = /^0x[0-9a-fA-F]{40}$/;
const ORDER_ID = /^\d{1,18}$/;

export default async function Page({ params }: { params: Promise<{ vault: string; orderId: string }> }) {
  const { vault, orderId } = await params;
  const valid = VAULT.test(vault) && ORDER_ID.test(orderId);
  return (
    <AppShell>
      {valid ? (
        <ReportPage vault={vault.toLowerCase() as `0x${string}`} orderId={orderId} />
      ) : (
        <EmptyState art="notfound" title="This order does not exist." titleAs="h1" />
      )}
    </AppShell>
  );
}
