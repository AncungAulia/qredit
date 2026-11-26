import { AppShell } from "@/components/layout/AppShell";
import { NewOrderPage } from "@/modules/orders";

export const metadata = { title: "New order" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AppShell>
      <NewOrderPage slug={slug} />
    </AppShell>
  );
}
