import { keccak256 } from "viem";

/** keccak256 of the envelope's UTF-8 text: the value committed on chain as requestRef / envelopeHash. */
export const envelopeHash = (body: string): `0x${string}` => keccak256(new TextEncoder().encode(body));
