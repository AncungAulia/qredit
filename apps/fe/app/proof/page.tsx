import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ProofPage } from "@/modules/proof";

export const metadata = { title: "Proof" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  return (
    <AppShell>
      <Suspense>
        <ProofPage tab={tab === "attacks" ? "attacks" : "claims"} />
      </Suspense>
    </AppShell>
  );
}
