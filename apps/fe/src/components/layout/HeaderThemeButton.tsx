"use client";

import { useWallet } from "@/modules/wallet";
import { ThemeButton } from "./ThemeButton";

/**
 * The theme control of the header. When the account button opens the account menu (an unlocked test wallet or
 * QoreX) the theme lives in that menu, so the header shows only one control. Without a wallet, and while the
 * wallet is locked (its button opens the unlock form, not a menu), the header keeps the button. Until the
 * browser storage has been read the button's space is held so nothing jumps.
 */
export function HeaderThemeButton({ className }: { className?: string }) {
  const kind = useWallet((s) => s.session.kind);
  const hydrated = useWallet((s) => s.hydrated);
  if (hydrated && kind !== "none" && kind !== "locked") return null;
  return <ThemeButton className={className} />;
}
