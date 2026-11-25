import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "@/lib/utils";

type Tone = "default" | "active" | "warning";

const TONES: Record<Tone, string> = {
  default: "bg-surface-muted border-transparent hover:bg-surface-hover",
  active: "bg-accent-soft border-accent",
  warning: "bg-warning-soft border-warning",
};

type Common = {
  icon: ReactNode;
  /** Fill of the icon tile: the inverse surface for QoreX, a muted surface for the test wallet. */
  iconTile: string;
  title: string;
  badge?: ReactNode;
  description: string;
  trailing: ReactNode;
  tone?: Tone;
};

const base =
  "flex w-full items-center gap-3.5 rounded-lg border-[1.5px] p-4 text-left transition-[background-color,transform] duration-[120ms] ease-[var(--ease-out)] active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 pointer-coarse:min-h-11";

function Content({ icon, iconTile, title, badge, description, trailing }: Common) {
  return (
    <>
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", iconTile)}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium text-text-primary">{title}</span>
          {badge}
        </span>
        <span className="text-[13px] leading-normal text-text-secondary">{description}</span>
      </span>
      {trailing}
    </>
  );
}

/** One way in from the Connect dialog (design: Option QoreX, Option Test). A button, or a link to the install page. */
export function ConnectOption(props: Common & Omit<ComponentProps<"button">, keyof Common | "children">) {
  const { icon, iconTile, title, badge, description, trailing, tone = "default", className, ...rest } = props;
  return (
    <button type="button" className={cn(base, TONES[tone], focusRing, className)} {...rest}>
      <Content {...{ icon, iconTile, title, badge, description, trailing }} />
    </button>
  );
}

export function ConnectOptionLink(props: Common & Omit<ComponentProps<"a">, keyof Common | "children">) {
  const { icon, iconTile, title, badge, description, trailing, tone = "default", className, ...rest } = props;
  return (
    <a className={cn(base, TONES[tone], focusRing, className)} {...rest}>
      <Content {...{ icon, iconTile, title, badge, description, trailing }} />
    </a>
  );
}
