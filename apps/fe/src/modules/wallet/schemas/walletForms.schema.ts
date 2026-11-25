import { z } from "zod";
import { passwordSchema } from "@/modules/wallet/keystore";

const normalizePhrase = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

const passwordsMatch = (v: { password: string; confirm: string }) => v.password === v.confirm;

export const createWalletSchema = z
  .object({
    saved: z.boolean().refine((v) => v, "Confirm that you saved the recovery phrase."),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine(passwordsMatch, { path: ["confirm"], message: "The passwords do not match." });
export type CreateWalletValues = z.infer<typeof createWalletSchema>;

export const importWalletSchema = z.object({
  // The phrase list is part of the SDK; it is loaded when the phrase is first checked, not with the page.
  phrase: z.string().refine(async (v) => (await import("@qorechain/sdk")).validateMnemonic(normalizePhrase(v)), "This is not a valid recovery phrase."),
  password: passwordSchema,
});
export type ImportWalletValues = z.infer<typeof importWalletSchema>;

export const unlockSchema = z.object({ password: z.string().min(1, "Enter the password of this test wallet.") });
export type UnlockValues = z.infer<typeof unlockSchema>;

/** Same field as unlock, used to prove the owner of the browser before the phrase is shown. */
export const revealSchema = unlockSchema;

export { normalizePhrase };
