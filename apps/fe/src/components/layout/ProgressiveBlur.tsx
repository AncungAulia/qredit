/**
 * Progressive blur behind the sticky header: strongest at the top edge and gone at the bottom, no hard
 * line (design ProgressiveBlur). One backdrop-filter layer masked with a gradient, plus a paper tint.
 */
export function ProgressiveBlur() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[120px] bg-linear-to-b from-bg/70 to-transparent [mask-image:linear-gradient(to_bottom,#000_35%,transparent)] backdrop-blur-md motion-reduce:bg-bg motion-reduce:backdrop-blur-none"
    />
  );
}
