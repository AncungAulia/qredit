export type VaultStateName = "Raising" | "Active" | "Trapped" | "Repaid" | "Refunded";
const NAMES: VaultStateName[] = ["Raising", "Active", "Trapped", "Repaid", "Refunded"];

/** Maps the chain state number to its name. An unknown number is an error, never a guess. */
export const vaultStateName = (n: number): VaultStateName => {
  const name = NAMES[n];
  if (!name) throw new Error(`Unknown vault state ${n}`);
  return name;
};