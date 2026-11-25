import Image from "next/image";
import { AGENT_ART } from "@/config/businesses";
import { cn } from "@/lib/utils";

/** Agent mark: two image layers that switch with the theme. Decorative; the name sits beside it. */
export function BusinessMark({
  slug,
  size = 44,
  className,
}: {
  slug: keyof typeof AGENT_ART;
  size?: number;
  className?: string;
}) {
  const art = AGENT_ART[slug];
  return (
    <span
      className={cn(
        "relative inline-block shrink-0 overflow-hidden rounded-xl bg-surface-muted",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src={`/agents/${art}-light.png`}
        alt=""
        width={size * 2}
        height={size * 2}
        className="size-full object-cover dark:hidden"
      />
      <Image
        src={`/agents/${art}-dark.png`}
        alt=""
        width={size * 2}
        height={size * 2}
        className="hidden size-full object-cover dark:block"
      />
    </span>
  );
}
