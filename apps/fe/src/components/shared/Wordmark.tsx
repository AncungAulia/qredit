import type { WordmarkArt } from "@/config/wordmark";

/** Outlined Qredit letters. Takes the colour of the surrounding text. */
export function Wordmark({ art, className }: { art: WordmarkArt; className?: string }) {
  return (
    <svg
      role="img"
      aria-label="Qredit"
      viewBox={`0 0 ${art.width} ${art.height}`}
      className={className}
      fill="currentColor"
    >
      {art.paths.map((p, i) => (
        <path
          key={i}
          transform={p.transform}
          d={p.d}
          fillRule={p.evenodd ? "evenodd" : undefined}
        />
      ))}
    </svg>
  );
}
