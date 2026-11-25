import { cn } from "@/lib/utils";

// The blue orb of the design's Avatar: a dark-to-blue base with a light highlight and a soft glow.
const ORB_BACKGROUND = [
  "radial-gradient(circle at 78% 80%, #4FA6ECCC 0%, #4FA6EC00 70%)",
  "radial-gradient(circle at 30% 28%, #E3F2FD 0%, #7CC8FA99 35%, #5CB8F500 90%)",
  "linear-gradient(135deg, #1A6AAE, #17171A)",
].join(", ");

/** The decorative account avatar. It carries no meaning; the address next to it does. */
export function Orb({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block size-8 shrink-0 rounded-full", className)}
      style={{ background: ORB_BACKGROUND }}
    />
  );
}
