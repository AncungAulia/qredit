import { cn } from "@/lib/utils";

const GRADES = ["A", "B", "C", "D", "E", "F"];
const TICKS = 27;
const SWEEP = 270;
const CENTER = 120;
const OUTER = 100;
const INNER = 84;

/** The share of the dial that is lit: a full ring for A, one sixth for F. Decoration only; the letter is the grade. */
const litShare = (grade: string) => (GRADES.length - Math.max(0, GRADES.indexOf(grade))) / GRADES.length;

/** The RiskDial of the design: a ring of ticks with the grade letter inside. */
export function RiskDial({ grade, className }: { grade: string; className?: string }) {
  const lit = Math.max(1, Math.round(TICKS * litShare(grade)));
  return (
    <div className={cn("relative mx-auto aspect-[240/190] w-full max-w-[260px]", className)}>
      <svg viewBox="0 0 240 190" aria-hidden className="absolute inset-0 size-full">
        {Array.from({ length: TICKS }, (_, i) => {
          const angle = ((-SWEEP / 2 + (SWEEP * i) / (TICKS - 1)) * Math.PI) / 180;
          const sin = Math.sin(angle);
          const cos = -Math.cos(angle);
          return (
            <line
              key={i}
              x1={CENTER + INNER * sin}
              y1={CENTER + INNER * cos}
              x2={CENTER + OUTER * sin}
              y2={CENTER + OUTER * cos}
              strokeWidth={5}
              strokeLinecap="round"
              className={i < lit ? "stroke-accent-strong" : "stroke-surface-muted"}
              opacity={i < lit ? 0.35 + (0.65 * (i + 1)) / lit : 1}
            />
          );
        })}
      </svg>
      <div className="absolute inset-x-0 top-[24%] flex flex-col items-center gap-1">
        <span className="text-[84px] leading-none font-light text-text-primary">{grade}</span>
        <span className="text-sm font-medium text-accent-strong">Grade</span>
      </div>
    </div>
  );
}
