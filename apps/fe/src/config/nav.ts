import { HandCoins, Inbox, ShieldCheck, Store, type LucideIcon } from "lucide-react";

// Icons follow the TabBar component in the design (store, hand-coins, inbox, shield-check).
export const NAV: {
  href: string;
  label: "Market" | "Lend" | "Inbox" | "Proof";
  icon: LucideIcon;
}[] = [
  { href: "/", label: "Market", icon: Store },
  { href: "/lend", label: "Lend", icon: HandCoins },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/proof", label: "Proof", icon: ShieldCheck },
];

export const isActive = (href: string, pathname: string) =>
  href === "/"
    ? pathname === "/" || pathname.startsWith("/agents")
    : pathname === href || pathname.startsWith(`${href}/`);

/** The phone tab bar shows only on the top-level pages. */
export const isTopLevel = (pathname: string) => NAV.some((item) => item.href === pathname);
