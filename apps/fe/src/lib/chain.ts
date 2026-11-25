import { publicClientFor } from "@qredit/qore";
import { env } from "./env";

export const publicClient = publicClientFor(env.evmUrl);

/** The Cosmos REST API has no CORS headers, so browser calls go through this app's proxy (src/app/api/chain/rest). */
export const restUrl = () => `${typeof window === "undefined" ? "" : window.location.origin}/api/chain/rest`;
