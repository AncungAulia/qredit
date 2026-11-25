import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/PageStates";
import { Button } from "@/components/ui/button";

// Copy from the "Page not found" band in the design. No tab is active because the path matches no section.
export default function NotFound() {
  return (
    <AppShell>
      <EmptyState
        art="notfound"
        title="This page does not exist"
        message="The link may be wrong, or the page has moved."
        action={
          <Button variant="secondary" size="sm" render={<Link href="/" />} nativeButton={false}>
            Go to the market
          </Button>
        }
      />
    </AppShell>
  );
}
