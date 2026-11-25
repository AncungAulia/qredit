import { AppShell } from "@/components/layout/AppShell";
import { InboxPage } from "@/modules/inbox";

export const metadata = { title: "Inbox" };

export default function Page() {
  return (
    <AppShell>
      <InboxPage />
    </AppShell>
  );
}
