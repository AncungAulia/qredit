// The time an address may ask the faucet again, kept per address for the tab so a reload keeps the message.
const key = (address: string) => `qredit.faucetRetry.${address}`;

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The stored time, or null when there is none or it has passed. */
export function readRetryAt(address: string, storage: Storage | null = session(), now = Date.now()): Date | null {
  try {
    const raw = storage?.getItem(key(address));
    if (!raw) return null;
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) || at.getTime() <= now ? null : at;
  } catch {
    return null;
  }
}

export function writeRetryAt(address: string, at: Date | null, storage: Storage | null = session()): void {
  try {
    if (at) storage?.setItem(key(address), at.toISOString());
    else storage?.removeItem(key(address));
  } catch {
    // Storage is blocked; the message then lasts until the dialog closes.
  }
}
