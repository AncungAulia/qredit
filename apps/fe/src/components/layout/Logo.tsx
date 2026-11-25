import Link from "next/link";
import { LOGO_ART } from "@/config/wordmark";
import { Wordmark } from "@/components/shared/Wordmark";

/** The wordmark at UI size. Links to the market. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="Qredit" className={className}>
      <Wordmark art={LOGO_ART} className="h-[18px] w-auto text-text-primary" />
    </Link>
  );
}
