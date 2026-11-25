/** The wire types of the backend relay (POST /v1/relay), shared by the backend, the engine and the tx-index reader. */
export const EXECUTE_EVM_TYPE_URL = "/qorechain.abstractaccount.v1.MsgExecuteEVM";

export type RelayRequest = {
  typeUrl: string;
  value: {
    relayer: string; account: string; scheme: string;
    pubkey: string; signature: string; // base64
    to: string; value: string;
    data: string; // base64 calldata
    gasLimit: string; nonce: string;
  };
};
/** "refused" and "execution_failed" are definitive; "not_broadcast" and "unconfirmed" leave the outcome unknown. */
export type RelayFailureCode = "not_broadcast" | "refused" | "unconfirmed" | "execution_failed";
export type RelayResult = { txHash: string; success: true } | { txHash: string; success: false; code: RelayFailureCode; reason: string };
