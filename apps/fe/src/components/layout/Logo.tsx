import Link from "next/link";
import { LOGO_ART } from "@/config/wordmark";
import { cn, focusRing } from "@/lib/utils";
import { Wordmark } from "@/components/shared/Wordmark";

/** The wordmark at UI size. Links to the market. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Qredit"
      className={cn("inline-flex min-h-11 items-center rounded-md", focusRing, className)}
    >
      <Wordmark art={LOGO_ART} className="h-[18px] w-auto text-text-primary" />
    </Link>
  );
}
