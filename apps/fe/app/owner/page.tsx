import { AppShell } from "@/components/layout/AppShell";
import { OwnerPage } from "@/modules/owner";

export const metadata = { title: "Owner console" };

export default function Page() {
  return (
    <AppShell>
      <OwnerPage />
    </AppShell>
  );
}
