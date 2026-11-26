import { SETUP_ORDER, type SetupStatus, type SetupStep } from "@/modules/wallet/setup/steps";

export type StepDisplay = "done" | "next" | "waiting";

/**
 * What the list shows for each step. A tick needs every earlier step to be done as well: a step that is
 * done on chain while an earlier one is open shows as waiting, so the list never reads as ahead of itself.
 */
export function setupDisplay(status: SetupStatus): Record<SetupStep, StepDisplay> {
  let open = false;
  const out = {} as Record<SetupStep, StepDisplay>;
  for (const step of SETUP_ORDER) {
    if (open) out[step] = "waiting";
    else if (status[step] === "done") out[step] = "done";
    else {
      out[step] = "next";
      open = true;
    }
  }
  return out;
}
