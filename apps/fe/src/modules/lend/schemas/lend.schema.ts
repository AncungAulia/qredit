import { z } from "zod";
import { formatFusd, parseFusd } from "@/lib/format";

export type LendLimits = {
  /** The fUSD the wallet holds; null while it is not known. */
  balance: bigint | null;
  /** What is left to raise: target minus raised. */
  room: bigint;
};

/** Units of an amount typed as text; a trailing dot is allowed while the person is still typing. */
export const amountUnits = (text: string): bigint | null => parseFusd(text.replace(/\.$/, ""));

/** The Lend form: one amount, checked against the room left in the raise and the balance of the wallet. */
export const lendSchema = ({ balance, room }: LendLimits) =>
  z.object({
    amount: z.string().superRefine((text, ctx) => {
      const issue = (message: string) => ctx.addIssue({ code: "custom", message });
      if (text.trim() === "") return issue("Enter an amount.");
      const units = amountUnits(text);
      if (units === null || units <= 0n) return issue("Enter an amount greater than zero.");
      if (units > room) {
        return issue(`This exceeds the ${formatFusd(room)} still available. Enter ${formatFusd(room)} or less.`);
      }
      if (balance !== null && units > balance) {
        return issue(
          balance === 0n
            ? "Your wallet holds no fUSD to lend."
            : `This exceeds your balance of ${formatFusd(balance)}. Enter ${formatFusd(balance)} or less.`,
        );
      }
    }),
  });
export type LendValues = z.infer<ReturnType<typeof lendSchema>>;
