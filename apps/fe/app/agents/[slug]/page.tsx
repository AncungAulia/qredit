import { AppShell } from "@/components/layout/AppShell";
import { BusinessPage } from "@/modules/business";

export const metadata = { title: "Business" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AppShell>
      <BusinessPage slug={slug} />
    </AppShell>
  );
}
