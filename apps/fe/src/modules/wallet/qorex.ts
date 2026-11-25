// QoreX adapter. Wraps window.qorex.native (the QoreChain lane) behind one small client.
// QoreX cannot send EVM transactions; it supplies the address and the post-quantum order signature only.
import "@qorechain/qorex-types"; // brings the global Window.qorex type
import { qorToHex } from "@qredit/qore";
import { env } from "@/lib/env";

export type QorexState = "notInstalled" | "wrongNetwork" | "ready";

export type QorexClient = {
  /** Whether QoreX is present and not known to be on another network. */
  detect(): QorexState;
  connect(): Promise<{ address: string; evm: `0x${string}` }>;
  /** The post-quantum signature bytes of `text`, as the vault's applyOrder takes them. */
  signArbitrary(address: string, text: string): Promise<Uint8Array>;
  capabilities(): string[];
};

export class QorexNoPqSignature extends Error {
  constructor() {
    super("QoreX did not return a post-quantum signature.");
    this.name = "QorexNoPqSignature";
  }
}

export class QorexNotInstalled extends Error {
  constructor() {
    super("QoreX is not installed in this browser.");
    this.name = "QorexNotInstalled";
  }
}

/**
 * The shape the live probe (engine/spikes/web/index.html, QoreX 0.4.3) returned. The published types declare
 * signArbitrary as `Promise<never>` ("refused in current builds"), which the live wallet contradicts, so this
 * call follows the probe.
 */
type NativeLive = {
  capabilities?: readonly string[];
  enable(chainId: string): Promise<unknown>;
  getKey(chainId: string): Promise<{ bech32Address: string }>;
  signArbitrary(chainId: string, signer: string, data: string): Promise<{ pq?: { signature?: string } }>;
};

const WRONG_NETWORK = /unsupported chain|unrecogni[sz]ed chain|chain.*not (found|supported)|wrong network/i;

function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function createQorexClient(win: Window = window): QorexClient {
  let wrongNetwork = false;
  const native = () => win.qorex?.native as unknown as NativeLive | undefined;
  const need = () => {
    const n = native();
    if (!n) throw new QorexNotInstalled();
    return n;
  };
  return {
    detect() {
      if (!native()) return "notInstalled";
      return wrongNetwork ? "wrongNetwork" : "ready";
    },
    async connect() {
      const n = need();
      try {
        await n.enable(env.chainId);
        const { bech32Address } = await n.getKey(env.chainId);
        const evm = qorToHex(bech32Address);
        if (!evm) throw new Error("QoreX returned an address that is not valid.");
        wrongNetwork = false;
        return { address: bech32Address, evm: evm as `0x${string}` };
      } catch (e) {
        if (e instanceof Error && WRONG_NETWORK.test(e.message)) wrongNetwork = true;
        throw e;
      }
    },
    async signArbitrary(address, text) {
      const sig = await need().signArbitrary(env.chainId, address, text);
      const b64 = sig?.pq?.signature;
      if (!b64) throw new QorexNoPqSignature();
      return fromBase64(b64);
    },
    capabilities() {
      return [...(native()?.capabilities ?? [])];
    },
  };
}
