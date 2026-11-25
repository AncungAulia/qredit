import { cn } from "@/lib/utils";
import { AccountButton } from "@/modules/wallet";
import { Logo } from "./Logo";
import { ProgressiveBlur } from "./ProgressiveBlur";
import { HeaderThemeButton } from "./HeaderThemeButton";

/** Phone header: logo left, theme right. Detail pages show their own back link in the page. */
export function MobileHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn("sticky top-0 z-30 h-[60px] items-center justify-between px-4", className)}
    >
      <ProgressiveBlur />
      <Logo />
      <div className="flex items-center gap-2">
        <HeaderThemeButton className="size-11" />
        <AccountButton compact />
      </div>
    </header>
  );
}
