// src/lib/schemas.ts: zod building blocks shared by feature schemas.
import { z } from "zod";

/**
 * A number field that starts empty (null) in the form and must be filled before submit.
 * Chain further rules with .pipe(), e.g. requiredNumber("The price is required").pipe(z.number().min(0)).
 */
export function requiredNumber(message: string) {
  return z
    .number()
    .nullable()
    .transform((value, ctx) => {
      if (value === null) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return value;
    });
}
