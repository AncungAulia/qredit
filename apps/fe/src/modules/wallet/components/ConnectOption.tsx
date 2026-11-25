import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tone = "default" | "active" | "warning";

const TONES: Record<Tone, string> = {
  default: "bg-surface-muted border-transparent hover:bg-surface-hover",
  active: "bg-accent-soft border-accent hover:bg-accent-soft",
  warning: "bg-warning-soft border-warning hover:bg-warning-soft",
};

type Common = {
  icon: ReactNode;
  /** Fill of the icon tile: the primary colour for QoreX, a muted surface for the test wallet. */
  iconTile: string;
  title: string;
  badge?: ReactNode;
  description: string;
  trailing: ReactNode;
  tone?: Tone;
};

const base =
  "h-auto w-full justify-start gap-3.5 rounded-lg border-[1.5px] p-4 text-left font-normal whitespace-normal active:scale-[0.99] disabled:active:scale-100";

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

/** One way in from the Connect dialog (design: Option QoreX, Option Test), as a shadcn Button. */
export function ConnectOption(props: Common & Omit<ComponentProps<typeof Button>, keyof Common | "children" | "variant">) {
  const { icon, iconTile, title, badge, description, trailing, tone = "default", className, ...rest } = props;
  return (
    <Button variant="ghost" className={cn(base, TONES[tone], className)} {...rest}>
      <Content {...{ icon, iconTile, title, badge, description, trailing }} />
    </Button>
  );
}

/** The same option as a link (the install page); a Button rendered as an anchor. */
export function ConnectOptionLink(props: Common & Omit<ComponentProps<"a">, keyof Common | "children">) {
  const { icon, iconTile, title, badge, description, trailing, tone = "default", className, ...rest } = props;
  return (
    <Button
      variant="ghost"
      nativeButton={false}
      role="link"
      className={cn(base, TONES[tone], className)}
      render={<a {...rest} />}
    >
      <Content {...{ icon, iconTile, title, badge, description, trailing }} />
    </Button>
  );
}
