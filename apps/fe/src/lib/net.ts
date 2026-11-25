import type { Net } from "@qredit/qore";
import { restUrl } from "./chain";
import { env } from "./env";

/** The CometBFT RPC has no CORS headers, so browser calls go through this app's proxy (app/api/chain/rpc). */
export const rpcUrl = () => `${typeof window === "undefined" ? "" : window.location.origin}/api/chain/rpc`;

/** The chain endpoints for transactions built in the browser. */
export const browserNet = (): Net & { evm: string } => ({ chainId: env.chainId, rest: restUrl(), rpc: rpcUrl(), evm: env.evmUrl });
