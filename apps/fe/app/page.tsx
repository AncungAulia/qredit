import { AppShell } from "@/components/layout/AppShell";
import { MarketPage } from "@/modules/market";

export const metadata = { title: "Market" };

export default function Page() {
  return (
    <AppShell>
      <MarketPage />
    </AppShell>
  );
}
