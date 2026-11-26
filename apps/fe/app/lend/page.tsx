import { AppShell } from "@/components/layout/AppShell";
import { PositionsPage } from "@/modules/lend";

export const metadata = { title: "My lending" };

export default function Page() {
  return (
    <AppShell>
      <PositionsPage />
    </AppShell>
  );
}
