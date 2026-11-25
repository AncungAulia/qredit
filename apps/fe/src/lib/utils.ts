import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The one keyboard focus style: 2px ring in the focus colour, offset 2 from the element. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
