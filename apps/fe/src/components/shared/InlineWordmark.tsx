import { INLINE_ART } from "@/config/wordmark";
import { Wordmark } from "./Wordmark";

/** Wordmark at text size for mentions of Qredit inside a sentence. Sits on the baseline. */
export function InlineWordmark() {
  return <Wordmark art={INLINE_ART} className="inline-block h-[0.8em] w-auto align-baseline" />;
}
