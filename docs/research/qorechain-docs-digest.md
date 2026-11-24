# QoreChain docs digest for Qredit

Notes taken from the official documentation (docs.qorechain.io, English pages, snapshot of chain v3.2.9 on testnet), read section by section and filtered for what Qredit uses. Each item names its source page. Facts here are what the docs say; anything a spike later proves or disproves is recorded in `engine/spikes/RESULTS.md`.

## Digest A: developer-guide (QoreChain docs, read 2026-11-24 snapshot)

Short names: AA = developer-guide__account-abstraction.txt, WIN = ..__evm-window-reference.txt, PRE = ..__evm-precompiles.txt, EVM = ..__evm-development.txt, PQS = ..__post-quantum-signing.txt, XVM = ..__cross-vm-reference.txt, EXCH = ..__exchange-integration.txt.
Not relevant (read/skimmed, nothing for Qredit): cosmwasm-development, cosmwasm-gas-and-limits, svm-*, building-from-source, running-a-validator, running-a-node, node-operators-v328, governance-proposals-contracts (CosmWasm upload via gov only).
Nothing in this section on: QoreSeal / KEM registry REST paths (only `qor_getKEMKey` mentioned, EVM), QoreX signArbitrary, MCP server, faucet limits.

### 1. Facts we rely on

**Abstract-account module (AA)**
- CONFIRMED enabled on testnet: "On the qorechain-diana testnet it was switched on by a governance decision (proposal 18, passed 27 October 2026) and reports enabled: true." Mainnet: `enabled: false`. Check `GET /qorechain/abstractaccount/v1/config`. Testnet runs v3.2.9 (since 20 Nov 2026, height 10,424,000); mainnet v3.2.8.
- Authenticators CONFIRMED: `register-authenticator <account> <scheme> <pubkey-base64> <permissions-csv> <expiry-unix> <label>`, scheme `ed25519` or `secp256k1`. Revoke is owner-only and instant.
- Spending rules CONFIRMED, with the names we use: `daily_limit`, `per_tx_limit`, `allowed_denoms`, `denom_limits` (`{"denom","per_tx_limit","daily_limit"}` decimal strings, v3.2.2), `allowed_evm_calls` (v3.2.2): `0x<target>` (any function) or `0x<target>/0x<selector>` (that function only). "Without an entry a rule-bound key can only send value, deploy ... and move the ERC-20 tokens listed in allowed_denoms. Listing a target trusts every argument of calls made to it, recipients included." Example: `"allowed_evm_calls":["0xROUTER/0x38ed1739"]`. Selector for vault.paySupplier goes in that form.
- ERC-20 denom in a rule is `erc20/<EIP-55 address>` (slash, address compared in EIP-55 form), NOT the bank denom `erc20:<addr>` (colon, case-sensitive). The doc's example uses the fUSD address `0x97143B771D34ddb9130b807b135Ae675A5a963CA`.
- Spending rules bind only authenticators/session keys, "not the owner's own key" (owner is limited on the EVM lane by the EVM window).
- MsgExecuteEVM digest: v2 required since v3.2.3: `sha256("qorechain-evm-auth-v2" ‖ chainId ‖ account ‖ pubkey ‖ to ‖ value ‖ data ‖ nonce ‖ gasLimit)`, fields length-prefixed, gasLimit 8-byte big-endian; no block accepts both forms. CLI `qorechaind query abstractaccount auth-sign-evm <chain-id> <account> <to-0xhex> <value-wei> <data-hex> <nonce> --seed-file ... --gas-limit N`; relay with `tx abstractaccount execute-evm <account> <to> <value-wei> <data-hex> <gas-limit> <scheme> <pubkey-b64> <sig-b64> <nonce> --from relayer`.
- Nonce: `MsgExecuteEVM.nonce` = the linked key's own sequence, `GET /qorechain/abstractaccount/v1/auth_nonce/{address}/{pubkey_hex}`, not eth_getTransactionCount. Stale nonce = code 11. It is "the same counter on both lanes".
- The call is executed "from the canonical account's 0x... address" (so the vault sees msg.sender = the spender account's 0x address). Relayer is signer/fee payer; relayer's own hybrid PQC signature covers the envelope.
- Fee floor: 0.1 uqor/gas (`--gas 400000` needs `--fees 40000uqor`). Cosmos tx gas cap 50,000,000; single EVM tx cap 30,000,000 (`GET /qorechain/pqc/v1/evm_limits`, EVM and WIN).
- Permissions (11 canonical, fail-closed): send, delegate/withdraw/vote..., `evm`/`wasm`/`svm`, amm/ibc/deploy, `all`. Live list: `GET /qorechain/abstractaccount/v1/permission_schema`. For paySupplier the spender key needs `evm` only (not `deploy`/`all`). Key-management msgs never delegable.
- Since v3.2.8 a key with value permissions (send, evm, svm, deploy, all) is refused at registration unless the account has an ENABLED spending rule bounding every denom it can spend. So `evm` key needs a rule. Rule resolution: authenticator's own rule, else first enabled account rule, else no limit; `enabled:false` = no limit.
- Since v3.2.8 registration needs a possession proof (field 8 `possession_proof`): the key signs the 5-line text `QoreChain authenticator link v1\nchain: qorechain-diana\naccount: <qor1...>\nscheme: ed25519\nkey: <lowercase hex pubkey>` (no trailing newline). ed25519: sign UTF-8 text bytes, 64-byte sig. SDK 0.14.0 has `signAuthenticatorLinkEd25519` / `signAuthenticatorLinkPhantom` / `linkAuthenticatorMsgs` (rule + link in one owner tx). CLI: `qorechaind tx abstractaccount link-message <account> ed25519 <pubkey-b64> --chain-id qorechain-diana`, `register-authenticator ... --possession-proof <b64>`.
- Tested on testnet 12 Nov with SDK 0.14.0: `linkAuthenticatorMsgs` (rule + link) 220,973 gas, code 0; revoke 194,244 gas. "The Phantom and ed25519 helpers ... were not run" (only the MetaMask/secp256k1 path was run). Our spender is ed25519, so test the ed25519 helper early.

**EVM window (WIN, EVM)**
- Message `/qorechain.pqc.v1.MsgOpenEVMWindow`, close `/qorechain.pqc.v1.MsgCloseEVMWindow`. Limits: `blocks` 1 to 17,280; `max_txs` 1 to 1,000; `max_value` positive uqor (value + max fee gas*feecap of each tx, rounded up); `allowed_targets` max 16 0x addresses (contract creation then refused); `native_only`; v3.2.8 lists `validators`, `staking_validators`, `ibc_receivers` (max 16 each). All three bounds required; opening replaces any open window.
- Block time: 17,280 blocks "about 15 hours on mainnet (3.1 s) and about 6 hours on the testnet (about 1.3 s ...; varies)"; WIN says "about 5 hours on the testnet". Doc is inconsistent between the two pages, so measure on testnet.
- What closes a window: any bound used up (blocks, txs, value); expiry; `MsgCloseEVMWindow`; "Rotating, migrating or re-registering the post-quantum key closes the window" and deletes EIP-7702 consent; a window works only while the PQ key is usable (not empty, not classical-only, not disabled by governance). A reverted-but-admitted tx still uses its slot and value.
- "The classical key alone can never open one." Open/close/EIP-7702 consent must be the account's own top-level hybrid-signed message, not via authz (CONFIRMS "only owner ML-DSA can open/renew").
- Only EVM-lane (classically signed) txs are governed. NOT governed: native-lane msgs the account signs, "Abstract-account executions authorised by the account's authenticators", ERC-20 conversions run by modules. So the spender's MsgExecuteEVM bypasses the window (consistent with our design), and operator's window only constrains the operator's own EVM-lane txs.
- Opening advances the account nonce (Native sequence = EVM nonce): open first, then read nonce; earlier-signed txs fail "nonce too low".
- Window counts native QOR only; ERC-20 transfers/approvals have value 0, "bound those with a scope (allowed_targets)". Listing a contract is consent to everything it can do with the account's assets; "do not list generic forwarder or router contracts". allowed_targets=[vault] fits our design, but note vault moves fUSD without any amount cap from the window.
- Refusal codes (codespace pqc): 26 no window / no key; 27 exhausted or out of scope; 28 invalid bounds; 62 delegated account no window. Over JSON-RPC the error arrives "as a broadcast error that carries the message and no codespace, so match on the text too". SDK `classifyEvmWindowRejection(err)` returns `"no-pqc-key"|"no-window"|"exhausted"|"invalid"`.
- Read: `GET /qorechain/pqc/v1/evm_window/{address}` returns 200 `found:false` when none (safe to poll); fields `live`, `remaining_blocks`, `remaining_txs`, `remaining_value`, `opened_height`, `expiry_height`, `allowed_targets`; testnet v3.2.9 also returns `validators`, `staking_validators`, `ibc_receivers`.
- SDK: `openEvmWindowMsg({sender, blocks, maxTxs, maxValue, allowedTargets, nativeOnly, ...})`, `closeEvmWindowMsg(addr)`, `fetchEvmWindow({rest, address})`; builder validates locally; `MAX_EVM_WINDOW_BLOCKS`, `MAX_EVM_WINDOW_TXS` exported. "The SDK never opens a window for you."
- EVM key must be eth_secp256k1 (coin type 60), not coin 118 (EVM).
- Permits/EIP-712 orders: since v3.2.8 a signature checked via ecrecover by a contract counts only if the signer's own live window lists the verifying contract. Applies to ecrecover only, not pqcVerify, so our ML-DSA orders are unaffected.
- Tested 12 Nov: open 187,282 gas; close 170,468 gas; open with lists 195,233 gas.

**Precompiles (PRE)**
- Testnet: PQC Verify `0x...0A01`, PQC Key Status `0x...0A02`, PRISM `0x...0C01` ACTIVE since 27 Oct 2026 (proposal 21); CrossVM `0x...0901` active with allowlist; AI pair not active. Mainnet: none active. Check `GET https://api-testnet.qore.host/cosmos/evm/vm/v1/params | jq .params.active_static_precompiles`.
- ABI: `pqcVerify(bytes pubkey, bytes signature, bytes message) view returns (bool)`; pubkey 2592 bytes, signature 4627 bytes (ML-DSA-87). Gas 25,000 + 8/byte of ABI input; "typical ML-DSA-87 verification costs roughly 85,000-90,000 gas".
- `pqcKeyStatus(address) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)`; algorithmId 1 = ML-DSA-87; gas 2,500. Account arg is the 0x address. cast example: `cast call 0x...0a02 "pqcKeyStatus(address)(bool,uint8,bytes,bool)" 0x...01 --rpc-url https://evm-testnet.qore.host`.
- Message prefix: NOT documented for pqcVerify (it verifies raw `message` bytes; any "domain prefix" is our own). The only documented ML-DSA domain strings are chain-side (`qorechain-pqc-pop-v1|...`, `qorechain-pqc-hybrid-v2`). So our order message format is free; bind chainId + vault + nonce ourselves.
- Inactive/unknown precompile address "succeeds and returns empty data (0x)". Guard: `require(ok && ret.length >= 96)`; typed interface calls revert on empty data (safe). Never send value to these addresses.
- Docs say contracts "must also require `possessionProven`" (key may be registered without proof of possession, optional). Our vault should require `possessionProven == true` and compare returned `pubkey` to the stored owner key.

**PQ keys (PQS)**
- ML-DSA-87 pubkey 2592 B, signature 4627 B; ML-KEM-1024 pubkey 1568 B, ciphertext 1568 B. `@qorechain/pqc` 0.2.3 (`npm i @qorechain/pqc`): `mldsa.keygen/sign/verify`, `mlkem.keygen/encapsulate/decapsulate`, `shake256`, `pubkeyHash`. Signing deterministic by default, chain accepts both. Use 0.2.1 or later.
- Key derivation: `seed = SHAKE-256("qorechain:pqc:v1|" + cosmosAddress + "|" + mnemonic)`; `qorechaind tx pqc recover-key`.
- Registration: `register-key-v2 dilithium5 <pubkeyhex> hybrid --pqc-key <name> --gas 600000 --fees 60000uqor`; first registration may be classically signed, after that every key msg must be hybrid-signed. Possession proof text `qorechain-pqc-pop-v1|<chain-id>|<alg id>|<address>|<pubkey hex>`; read `possession_proven` at `GET /qorechain/pqc/v1/account/{address}`. SDK `ensurePqcRegistered` attaches proof (SDK >= 0.9.0).
- Every Cosmos-lane tx on live networks needs hybrid ML-DSA-87 cosign (v2 sign-bytes: `"qorechain-pqc-hybrid-v2" ‖ BE64(len chainId) ‖ chainId ‖ ...`). SDK `client.connectTx(signer, { pqcKeypair })` does it. diana is v2 since v3.1.98.

**fUSD (EVM)**
- fUSD (FestUSD) `0x97143B771D34ddb9130b807b135Ae675A5a963CA`, **6 decimals**, bank denom `erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA`. fETH `0x02292293c13880a26242690eb70a0e42B8E91c28` (18), fBTC `0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A` (8). Registered by testnet governance proposal 26 (27 Oct 2026). `GET /cosmos/evm/erc20/v1/token_pairs`.
- "The faucet pays bank coins": to use fUSD in EVM you must `MsgConvertCoin` (bank to ERC-20; ~432,000 gas, use 600,000) with sender `qor1...`, receiver `0x...`. Back: `MsgConvertERC20` with sender qor1 (0x sender refused; CLI `convert-erc20` writes 0x sender before v3.2.7, fixed in v3.2.7+). Both are Cosmos-lane, need hybrid cosign. Conversions "were not run end to end" by the doc authors.

**Endpoints (EVM, WIN)**
- Testnet EVM `https://evm-testnet.qore.host` chain id 9800; REST `https://api-testnet.qore.host`; RPC `https://rpc-testnet.qore.host`; download manifest `https://download.qore.host/testnet/latest.json`. MetaMask currency symbol QOR. Mainnet 9801.
- EVM native QOR 18 decimals vs 6 for uqor (1 uqor = 10^12 wei).

### 2. APIs and exact names (collected)
- Type URLs: `/qorechain.pqc.v1.MsgOpenEVMWindow`, `/qorechain.pqc.v1.MsgCloseEVMWindow`, `/qorechain.pqc.v1.MsgRegisterPQCKeyV2` (`{sender, public_key, algorithm_id:1, key_type:"hybrid", proof_of_possession}`), `MsgRotatePQCKey`, `/cosmos.evm.erc20.v1.MsgConvertCoin`, `/cosmos.evm.erc20.v1.MsgConvertERC20`, `/qorechain.crossvm.v1.MsgCrossVMCall`. Abstract-account msg names: MsgRegisterAuthenticator, MsgRevokeAuthenticator, MsgUpdateSpendingRules, MsgExecuteEVM, MsgExecuteCosmos (full type URLs not printed in this section).
- REST (testnet base `https://api-testnet.qore.host`): `/qorechain/abstractaccount/v1/{config, accounts, accounts/{addr}, accounts/{addr}/authenticators, accounts/{addr}/spending_rules, permission_schema, auth_nonce/{address}/{pubkey_hex}, params}`; `/qorechain/pqc/v1/{evm_window/{address}, evm_limits, account/{address}, protocol_features, multisig/{address}, evm_delegation_consent/{address}}`; `/cosmos/evm/erc20/v1/token_pairs`; `/cosmos/bank/v1beta1/denoms_metadata`; `/cosmos/tx/v1beta1/txs/{hash}`.
- Failed execution search: `GET /cosmos/tx/v1beta1/txs?query=abstractaccount_execution_failed.account%3D%27<addr>%27&limit=10`.
- AA error codes (codespace abstractaccount): 5 limit exceeded, 6 expired, 8 invalid rule / value key without rule, 9 module disabled, 10 permission denied (also "possession_proof is required"), 11 replay/stale nonce. pqc 21 = relayer's hybrid signature failed.
- Events: `abstractaccount_execution_failed` (account, lane, nonce, reason), `pqc_evm_window_opened|used|closed` (used has `source` = ante or settlement; attrs address, evm_address, window_open_height, used_txs, used_value, tx_value).
- JSON-RPC: `qor_` namespace NOT served on public endpoints, except `qor_getKEMKey` on testnet only (observed 7 Nov 2026; mainnet answers -32601). `qor_getAbstractAccount` returns -32601. Public node limits: body 256 KiB, 256 concurrent requests.
- Cross-VM: `MsgCrossVMCall` open on testnet (proposal 37), params at `/qorechain/crossvm/v1/params`; circuit breaker `/cosmos/circuit/v1/disable_list`. Not needed for Qredit unless a CosmWasm helper is wanted.

### 3. Gotchas and limits
1. **A failed MsgExecuteEVM is a successful tx.** From v3.2.8, a reverted/limit-exceeded call returns tx code 0, response `success=false`, event `abstractaccount_execution_failed` with `reason`, and the authenticator nonce IS consumed (AA). The relayer must read the response or event; re-read `auth_nonce` before the next sign. Our paySupplier revert handling must use this.
2. **Value-moving authenticator needs an enabled bounded rule** (see section 1), with `denom_limits` per ERC-20 for an 18-decimal token; for fUSD (6 dec) amounts are in base units. A rule listing `allowed_evm_calls` for vault.paySupplier AND `allowed_denoms: ["erc20/0x9714..."]` if fUSD moves out of the account; "limits count per authorised execution". Note: the EVM lane now measures "the balance or allowance change of every listed ERC-20", so if the vault pulls fUSD from the spender account, it must be in allowed_denoms/denom_limits; if fUSD leaves the vault only, check whether it is counted at all.
3. Window needs a registered PQ key on the **operator** account, and operator key must be eth_secp256k1 coin 60. The window must be re-opened after any PQ key rotation. Window opening advances the nonce, so the operator's first EVM tx must read the nonce after opening.
4. Window max_value counts max fee (gas limit x fee cap): "gas limit of 30,000,000 at 100 gwei counts 3 QOR against max_value for one transaction". Set a small gas limit on operator txs or the window will exhaust quickly. Operator needs QOR for gas.
5. Only value windows; ERC-20 amounts the vault moves are bounded only by vault logic (WIN: "the window does not bound which tokens move or where"). Per-window `max_txs` is the practical rate limit.
6. Contract creation needs an UNSCOPED window; scoped (allowed_targets) refuses deploys. Deploy the vault with an unscoped window then close; or use VaultFactory from a scoped session only if factory is the target (and factory deploys count as target call, which is fine because the creation happens inside a call, not a creation tx, but unverified in docs).
7. Precompiles are guarded by governance list; testnet could change. `pqcKeyStatus` returns `(false,0,0x,false)` for no key. Always check `ret.length`.
8. pqcVerify gas ~85-90k+ per call, `precompile_input_max_bytes` 16,384, `tx_max_gas` 30,000,000. A 4627 B sig + 2592 B key + message is well under 16 KiB.
9. Public SVM gateway does not relay (irrelevant). Public REST has no stated rate limit in this section; node guide advises reverse proxy / rate limiting for your own endpoints.
10. Testnet tx hash and lookups: 404 for unknown hash. `eth_getBlockByNumber/Receipts/feeHistory` fixed in v3.2.7.
11. SDK 0.13.0 cannot build the possession proof; use **0.14.0** (the brief's version) for authenticator registration and window lists. Python/Go/Rust/Java ed25519 helpers untested.
12. `qorechaind` Linux-only (no macOS binary); community build cannot sign. Use SDK/QoreX for hybrid signing.
13. EVM unprotected (pre-EIP-155) txs refused: always set chainId 9800.
14. Doc staleness: AA page says "checked 27 October 2026" for the module state; testnet accounts list "four on 27 October". Re-check `config` before demo.
15. `GET /qorechain/crossvm/...` is 501 on mainnet public gateway (irrelevant for testnet).

### 4. Opportunities
- **`GET /qorechain/pqc/v1/evm_window/{address}` and `/abstractaccount/v1/accounts/{addr}/authenticators|spending_rules`**: give judges a no-wallet verification page ("owner window closed / spender rule = paySupplier only / key expiry") straight from REST; also `accounts/{addr}/spending_rules` and the `abstractaccount_execution_failed` event search for an audit feed.
- **`classifyEvmWindowRejection`, `assertAuthenticatorExecutionsSucceeded` (SDK), `fetchEvmWindow`**: replace hand-written error/status code in the relayer and the dashboard (AA, WIN).
- **`linkAuthenticatorMsgs`** (SDK 0.14.0) builds rule + link in one owner-signed tx (220,973 gas), and `signAuthenticatorLinkEd25519` produces the proof: replaces the planned manual 5-line text signing. CLI `link-message` prints the exact text.
- **`qorechaind query abstractaccount auth-keygen / auth-sign-evm`** cross-check tools to validate our TypeScript digest v2 builder (AA).
- **`pqcKeyStatus.possessionProven`**: gate the vault on it; surface it in the UI as a trust badge. `GET /qorechain/pqc/v1/protocol_features` lists feature flags (101 on mainnet) for a demo readiness check.
- **`openEvmWindowMsg` validates bounds locally** and exports `MAX_EVM_WINDOW_BLOCKS/TXS`: use for owner UI validation.
- **QoreX "EVM access window" card** exists (app and extension) but exposes only blocks/txs/cap, NOT `allowed_targets`: our scoped window (allowed_targets=[vault]) must be built with the SDK and the owner signs hybrid in QoreX/SDK, not via that card (WIN, "MetaMask and QoreX flow").
- **Hybrid multisig / SIGN_MODE_TEXTUAL** (v3.2.7): `POST /qorechain/pqc/v1/textual_sign_doc` for web wallets (PQS); optional.
- **`@qorechain/chain-bridge`** (server side): `ChainBridge({cosmosRpc,cosmosRest,chainId,signerMnemonic}).sendTokens/registerPqc` handles derivation, hybrid signing, broadcast for the relayer (EXCH). `@qorechain/wallet-adapter` `QoreChainSigner.signHybrid`.
- **Cross-VM `0x0901` bridge** (needs a window listing `0x...0901`) and CosmWasm receipts: testnet governance stored a "qday-receipts" CosmWasm contract (proposal 40, code 865, allowlisted) as an example of on-chain receipts called from Solidity; could be used for a verifiable repayment log if wanted (governance-proposals-contracts). Likely out of scope.
- `rlConsensusParams()` at `0x...0c01` returns block time target (ms): usable to display window durations (PRE).

### 5. Contradictions / tensions with our spec
(Spec file not re-read here; contradictions are against the brief's description.)
- Brief: "agent's **operator** ... classical key inside a scoped EVM window (allowed_targets = vault) that only the owner can open/renew". Docs CONFIRM, but: the window must be opened by a hybrid-signed **Native** message from the OPERATOR account itself ("must be the account's own top-level, hybrid-signed message ... cannot be sent through authz or granted to another account"). So "owner opens the operator's window" is NOT possible unless the owner's PQ key is the operator account's PQ key (same account), or it is the operator account's own ML-DSA key held by the owner. Quote: "Opening and closing are Native-lane transactions and need the account's hybrid (classical plus ML-DSA-87) signature, and the account must already hold a registered post-quantum key." Check whether the spec treats owner PQ key == operator account's registered key.
- Brief: "`pqcVerify` ... message prefix". Docs define no prefix; message is raw bytes.
- Brief: abstract-account "linked ed25519 key ... allowed_evm_calls = vault.paySupplier": docs add the v3.2.8 constraint that a value-permission key needs an enabled rule bounding ALL denoms (registration fails with code 8 otherwise) and possession proof (code 10 otherwise); and "A key with only non-value permissions ... does not need a rule", but `evm` IS a value permission.
- Brief: "QoreX testnet switch in the EXTENSION": not covered in this section; only "MetaMask against chain id 9800 (testnet)" and "QoreX extension: the EVM access window button in the popup".
- WIN states testnet window of 17,280 blocks is "about 5 hours" while EVM says "about 6 hours" (1.3 s per block would be 6.2 h). Use `rlConsensusParams`/measure rather than assume.
- Docs say the spender's MsgExecuteEVM is not bounded by the window, while spec may assume window also limits spender; it does not (rules do).


## Digest B: sdk, qoresign, qorex (45 files, all read in full)

### 0. Priority answers (QoreX)

- **Extension testnet switch: NOT documented.** The only documented switch is mobile: "Settings → Use testnet (developers) - switches to the qorechain-diana testnet (EVM chain ID 9800); the app re-binds live, with no restart" (qorex__dapp-browser, qorex__getting-started, qorex__overview). The extension page only says "The extension follows the network it is set to; mainnet qorechain-vladi is the default" (qorex__browser-extension) and never says how to set it. No doc mentions v0.4.x: current store versions as of 27 Oct 2026 are Chrome 0.3.8, Firefox 0.3.9, Safari ext 0.3.8. A dApp cannot switch networks: "chainId must equal the wallet's active network ... A dApp cannot switch the network; only the user can." Dashboard requests also never switch it (qorex__browser-extension, qorex__troubleshooting). Fallback: the mobile app has a TESTNET badge and toggle.
- **signAndBroadcast**: `window.qorex.native.signAndBroadcast({ chainId, messages:[{typeUrl, value: bytes}], memo?(<=256 bytes), gasLimit? })` returns `{ txHash, code, height? }`. Feature-detect with `provider.capabilities?.includes("signAndBroadcast")`; call `provider.enable(chainId)` once per site. 1-32 messages per call, bytes signed exactly as sent. Available from extension 0.3.5 / app 1.1.5. (qorex__browser-extension)
- **Which message types?** No allowlist is published. The doc states the rule: QoreX "decodes every message", shows fee, and "refuses anything it cannot display" ("QoreX cannot read this message ... Approve only if you trust this site completely"); "a request QoreX cannot decode ... is refused" (qorex__security-and-recovery, qorex__overview). Explicitly refused: "ML-DSA-87 key management (register, migrate, rotate - also inside authz MsgExec) is refused: the wallet manages the account's key itself" and "Websites cannot ask QoreX to register, migrate or rotate your ML-DSA-87 key". Explicitly decoded: bank, staking, authz MsgExec (nested), grants/fee allowances, governance votes, IBC transfer memos. **MsgRegisterKEMKey is not mentioned anywhere in the QoreX docs.** It is not ML-DSA key management, so it is not in the refused list, but whether QoreX can decode it is unknown (must test on a device). Note the chain requires it to be hybrid-signed (SDK `msg.pqc.registerKemKey`, sdk__guides__quantum-safe), which signAndBroadcast would add. Safest plan: register the KEM key from the backend/script with the SDK (hybrid TxClient), not via QoreX.
- **EVM signing in QoreX: NO.** "It does not sign or send EVM transactions or messages yet: other methods return 'EVM method ... not yet supported'." Only `eth_requestAccounts`, `eth_accounts`, `eth_chainId`, `wallet_switchEthereumChain` work (any other chain returns 4902). "Use MetaMask or another EVM wallet for EVM-lane transactions" (qorex__browser-extension, qorex__dapp-browser, qorex__overview). MsgExecuteEVM / MsgOpenEVMWindow in signAndBroadcast are not discussed as allowed or refused.
- **signArbitrary: NOT supported** in extension or mobile ("signArbitrary (message signing) is not supported"; "Message signing (signArbitrary) is not shipped"). Also absent: `signAmino`, `sendTx`, any `window.keplr` alias. `signDirect` exists but only accepts a body with a page-attached ML-DSA layer that matches the registered key; classical-only is refused, and it is refused for coin-60 accounts.

### 1. Facts we rely on (confirm / contradict)

**Authenticators / abstract account** (sdk__guides__authenticators)
- Module "disabled on qorechain-vladi ... enabled on the testnet" (`GET /qorechain/abstractaccount/v1/config` returns enabled true on testnet). CONFIRMED for testnet.
- Msgs: `/qorechain.abstractaccount.v1.MsgExecuteEVM`, `.MsgExecuteCosmos`, `/qorechain.pqc.v1.MsgRotatePQCKey`; `MsgRegisterAuthenticator`, `MsgUpdateSpendingRules`, `revokeAuthenticator`.
- Relayer pays fees; its own hybrid signature satisfies the envelope; the linked key signs a digest. Nonce = per-authenticator counter, not the EVM nonce; read it with `fetchAuthNonce` via `GET /qorechain/abstractaccount/v1/auth_nonce/{address}/{pubkey_hex}`. Wrong nonce = abstractaccount code 11 (authenticator_replay).
- Digest: `evmAuthSignBytesV2` = sha256("qorechain-evm-auth-v2" || LP(chainId) || LP(account) || LP(pubkey) || LP(to) || LP(value) || LP(data) || BE64(nonce) || BE64(gasLimit)); v2 from chain v3.2.3, `gasLimit` must be non-zero; use `resolveEvmAuthDigestVersion({rest})`; builders default to "v1", so pass `digestVersion: "v2"`. `to` is 0x hex, `value` a decimal wei string, `data` raw calldata.
- SpendingRule fields in these docs: `id, perTxLimit, dailyLimit, allowedDenoms, enabled` (uqor, `erc20/0x...` denoms must name a 0x address). **The names `allowed_evm_calls` and `denom_limits` do not appear in these 45 files**, so the rule shape for "allowed_evm_calls = vault.paySupplier" cannot be confirmed here (see the abstract-account chain docs in another group). Permissions seen: "send", "evm", "svm", "all", "deploy". `GET /qorechain/abstractaccount/v1/permission_schema` returns the taxonomy and `key_management_msgs`.
- Limit resolution: the authenticator's own enabled rule, else the account's first enabled rule, else NO limit; `enabled:false` means no limit, not zero. Rules bind only authenticators/session keys, not the owner key.
- Error codes: abstractaccount 5 spending_limit_exceeded, 6 session_key_expired, 8 invalid spending rule, 9 module disabled, 10 permission_denied, 11 authenticator_replay; pqc 21 hybrid_verify_failed.
- Reads: `fetchSpendingRules` -> `GET /qorechain/abstractaccount/v1/accounts/{address}/spending_rules`; `fetchAuthenticators` -> `.../accounts/{address}/authenticators`.

**EVM windows** (sdk__guides__evm, qorex__security-and-recovery, qoresign__guides__evm-quantum-ready)
- Msg `MsgOpenEVMWindow` (SDK `openEvmWindowMsg`, `closeEvmWindowMsg`, `fetchEvmWindow`, `classifyEvmWindowRejection`). Bounds: blocks 1..17,280 (`MAX_EVM_WINDOW_BLOCKS`), maxTxs 1..1,000, `maxValue` in uqor = value PLUS each tx's max fee (gas limit x fee cap). Defaults in QoreX: 300 blocks (~16 min), 5 txs, 1 QOR; "about 15 hours" for 17,280 blocks (about 3.1 s/block).
- Scoped (v3.2.3+, SDK 0.9.0): `nativeOnly`, `allowedTargets` (up to 16 unique 0x addrs; contract creation refused). **Confirms spec: allowed_targets = vault works.** Warning: allowedTargets limits which contracts, not how much; a listed token admits any amount incl. approve; do not list forwarders/routers. v3.2.8 adds `validators`, `stakingValidators`, `ibcReceivers` (SDK 0.14.0); `fetchEvmWindow` does not return those three.
- Opening a window advances the account nonce ("opening a window advances your account's nonce ... a transaction prepared earlier fails with 'nonce too low'"). A new window replaces any open one. Opening costs a normal fee, hybrid-signed Native msg (about 195k gas observed with all lists, fee example 40,000 uqor / 400,000 gas).
- A window bounds only EVM-lane (classically signed) txs; "Cosmos messages signed with the hybrid PQC signature, such as cross-VM calls and authz, are outside it."
- Rejections: `classifyEvmWindowRejection` -> "no-pqc-key" | "no-window" | "exhausted" | "invalid". Protocol feature `evm-pqc-authorisation-window`.
- Not in these docs: what closes a window beyond expiry/exhaustion/explicit close; the window's interaction with MsgExecuteEVM.
- **QoreX offers no screen for scoped windows** ("QoreX offers no screen for scoped EVM windows (the chain supports them since v3.2.3)"); its screen has only blocks/txs/cap, for coin-60 accounts. Scoped windows therefore need SDK/CLI (`qorechaind tx pqc open-evm-window --native-only / --allowed-targets`). This contradicts any plan to let the owner open the scoped window from QoreX.

**Precompiles**: testnet active list 0x...0A01 (pqcVerify), 0x...0A02 (pqcKeyStatus), 0x...0C01 (consensus params); the testnet list also held cross-VM bridge 0x...0901 from 4 Nov (allowlisted); AI pair 0B01/0B02 inactive; mainnet none. `pqcKeyStatus(address) returns (bool registered, uint8 algorithmId, bytes pubkey)`. Docs here give no pqcVerify ABI, gas or message prefix. EVM bindings: `precompiles.pqcKeyStatus(publicClient, account)`, ABI `IQORE_PQC_ABI` in `@qorechain/evm`.

**Message prefixes the owner's ML-DSA signature can carry** (qoresign__spec__message-signing-v1): `pq.signature = ML-DSA-87.Sign(sk, UTF-8("qorechain-msg-v1|" + chain_id + "|") || data, ctx = "")`; the classical part is ADR-36. Reserved domain prefixes: `qorechain-pqc-hybrid-v2`, `qorechain-pqc-pop-v1|`, `qorechain:pqc:recovery:v1`, `qorechain-svm-auth-v2`, `qorechain-siwq-v1|`, `qorechain-msg-v1|`. "A wallet must never sign raw bytes with the ML-DSA-87 key without one of these prefixes." Whether the pqcVerify precompile prepends such a prefix is not stated here; check the precompile docs. Sizes: pk 2,592 B, sk 4,896 B, sig 4,627 B, seed 32 B. ML-DSA ctx = "".

**ML-KEM registry** (sdk__guides__quantum-safe, sdk__install): chain v3.2.5+; one key per account, algorithm id 2, 1,568 bytes; `msg.pqc.registerKemKey({sender, publicKey})` (a second call replaces), `msg.pqc.removeKemKey({sender})`; read `GET /qorechain/pqc/v1/kem/{address}` (bech32 or 0x) via `fetchKemKey` -> `{found, key?}` with algorithm, key bytes, registration height. Validation: exact size, every coefficient < 3329, not all zero (`validateKemPublicKey`). Needs hybrid signature AND the account's ML-DSA key registered first; refusals pqc 250 to 254 via `decodeTxError`. Testnet and mainnet both serve it. SDK does not encrypt: use `@qorechain/qoreseal` 0.1.0. No "card format" in these files (QoreSeal docs elsewhere). A test of the SDK registered/read/removed a KEM key on testnet.

**Faucet / test tokens** (sdk__reference__network): testnet-only bank denoms `erc20:<EIP-55 contract>` (case-sensitive): fUSD (6 decimals), fETH (18), fBTC (8); list at `GET https://api-testnet.qore.host/cosmos/bank/v1beta1/denoms_metadata`. "Testnet test tokens (Fest)" page is elsewhere. QoreSign uses faucet account `qor178nscfyp0cq2ac5x7un4u98xrj4ayp6pt0kw08`.

**MCP**: only mention: the MCP server's `get_pq_status` tool uses QoreSign (qoresign__overview). No tool list here.

### 2. APIs and exact names

- Network: testnet `qorechain-diana`, EVM chain 9800, now **v3.2.9** (since height 10,424,000, 20 Nov 2026; mainnet v3.2.8). REST `https://api-testnet.qore.host`, RPC `https://rpc-testnet.qore.host`, EVM `https://evm-testnet.qore.host`, WS `wss://evm-ws-testnet.qore.host`, SVM read-only `svm-testnet.qore.host`. Fee denom uqor (6 dec; EVM shows 18), min gas price 0.1 uqor/gas (SDK client prices 0.15). Testnet endpoints "rate limited per IP". Viem chains: `qorechainTestnet` (9800), `qorechain` (9801) from `@qorechain/evm`.
- PQC status route: `GET /qorechain/pqc/v1/account/{address}` (singular) -> `{found, account}`. Other: `/qorechain/pqc/v1/protocol_features`, `/qorechain/pqc/v1/params`, `/qorechain/pqc/v1/evm_limits` (tx_max_gas 30,000,000, precompile_input_max_bytes 16,384), `/cosmos/evm/vm/v1/params` (active_static_precompiles), `/cosmos/circuit/v1/disable_list`.
- Key registration: `/qorechain.pqc.v1.MsgRegisterPQCKeyV2` (fields sender, public_key, algorithm_id=1, ecdsa_pubkey, key_type "hybrid", proof_of_possession); classical-signed, about 600,000 gas (fee 60,000 uqor). POP message: `"qorechain-pqc-pop-v1|" + chain_id + "|" + algorithm_id + "|" + sender + "|" + lowercase_hex(public_key)`. Registering a second key fails AFTER the fee is taken; `ensurePqcRegistered` reads first.
- Hybrid tx: extension `/qorechain.pqc.v1.PQCHybridSignature` (algorithm_id, pqc_signature, optional pqc_public_key), sign-bytes v2 = `"qorechain-pqc-hybrid-v2" || BE64(len chain_id) || chain_id || BE32(len B0) || B0 || BE32(len A) || A`. Deterministic derivation: `derivePqcCanonical(address, mnemonic)` = SHAKE256("qorechain:pqc:v1|"+addr+"|"+mnemonic, 32). Hybrid bank send about 171,600 gas (`ceil(sim x 1.02) + 2000`).
- SDK entry points: `createClient({network:"testnet"})`, `client.connectTx(signer,{pqcKeypair})`, `tx.signAndBroadcast([msgs],"auto")`, `signAndBroadcastHybrid`, `ensurePqcRegistered`, `msg.abstractaccount.*`, `linkAuthenticatorMsgs`, `signAuthenticatorLink{Phantom,Ed25519,Secp256k1,Eip191,MetaMask}`, `assertAuthenticatorExecutionsSucceeded`, `decodeAuthenticatorExecutions`, `decodeTxError`, `fetchProtocolFeatures`.
- QoreSign network helpers (`@qorechain/qoresign/network`, 0.2.0): `fetchPqKeyStatus`, `simulateTx`, `inspectTransaction({rest, chainId, txhash})`, `fetchEvmWindow({rest,address})` (returns found, live, heights, max/used tx and value, remaining, nativeOnly, allowedTargets), `verifyMessageWithChain`, `verifySiwqWithChain`.

### 3. Gotchas and limits

- **v3.2.8 rules (testnet since 12 Nov) for our spender link**: linking a key needs a possession proof (the linked ed25519 key signs a plain-text link message; use `signAuthenticatorLinkEd25519`); a key with send/evm/deploy/svm/all needs the account's first enabled spending rule to bound EVERY denom (`linkAuthenticatorMsgs` builds rule + link in one owner-signed tx); `spendingRules` there "replaces the account's rules wholesale: pass every rule to keep". Needs SDK 0.14.0 (we pin 0.14.0, good).
- **v3.2.8: failed authorised execution returns code 0.** `MsgExecuteEVM`/`MsgExecuteCosmos` can return `success=false` inside a code-0 tx and still consume the nonce. The relayer must call `assertAuthenticatorExecutionsSucceeded(result, messages)` / `decodeAuthenticatorExecutions`.
- Relayer's own ML-DSA-87 key must be registered; relayer pays fees. Every Native tx needs the hybrid signature (classical-only rejected), including the owner's register/open-window msgs.
- EVM txs need a registered ML-DSA key AND an open window (v3.2.0+); reads and gas estimation need none. EVM tx cap 30,000,000 gas; Cosmos 50,000,000.
- Gas for contract calls got repriced in v3.2.8 (CosmWasm only): first call of a code ~533k gas, repeats ~84k, congestion factor 1x to 20x; use simulated x 1.3.
- QoreX: coin-118 (qor1...) accounts cannot be used by MetaMask; windows only matter for coin-60 accounts. QoreX's "own sends use the Native lane and never need a window". Key rotation and linked signers are "not yet available inside QoreX". Handles/claiming are mobile-only. Approvals: a site may have 1 pending request (3 total); a wallet switch or lock answers waiting requests with "no"; requests with duplicated fields (ambiguous bytes) are refused; request identity is the browser-attested origin. Extension vault is local; Safari approvals open in a tab. `qor1` addresses are the same on both networks, so confirm network in the popup before signing.
- QoreX shows a "downgraded" warning if the ML-DSA layer is missing on chain.
- Mnemonic must be canonical (lowercase, single spaces) for ML-DSA derivation; QoreX imports with fewer than 24 words give a weaker PQ key. The QoreX ML-DSA key is derived from the same 24 words, so QoreSign can derive the owner's key offline.
- `@qorechain/react` `useTx` sends classical-only and cannot land txs. `qor_` JSON-RPC: testnet serves it from v3.2.9, mainnet not; prefer REST. Public REST sends no CORS headers (templates proxy `/lcd`), relevant to the Next.js app. SVM tx lane disabled. IBC: one open transfer channel on testnet only.
- Testnet nodes prune history ("Old testnet transactions may be gone"), relevant to verifying demo txs later.
- `@qorechain/wallet-adapter` and `@qorechain/connect`: connect is deprecated; use wallet-adapter (0.5.0; 0.6.0 matches SDK 0.14.0 per sdk__install).
- Dependency conflict: wallet-adapter peers `@cosmjs/*` ^0.32 vs SDK cosmjs 0.39 (ERESOLVE).

### 4. Opportunities

- **Transaction inspector** (`inspectTransaction`, QoreSign 0.2.0, TS): reports messages, signer, fee, hybrid layer state and tier (pqc/enrollment/shake/classical); the dashboard Developers page has a "Transaction inspector" tab: paste a txhash for a judge-friendly proof. Explorer labels EVM txs "Authorised by a PQC window".
- `fetchEvmWindow` / `evmWindowStatus` to show window state (remaining blocks/tx/value, `allowedTargets`) in the web UI.
- `verifyMessageWithChain` + `signMessage` (QoreSign): server-side check of an owner ML-DSA signature against the on-chain key, if we need an off-chain approval path (QoreX itself cannot produce it, but QoreSign can in-browser with the mnemonic, or SIWQ for login: `verifySiwqWithChain`, nonce single use, always set Expiration Time, default max age 600 s).
- QoreSign `assertPqLayerMatchesRegisteredKey` / `signPqLayer`: add the ML-DSA layer to a dApp-built body. `@qorechain/wallet-adapter`: dApp-held PQ key plus unchanged wallet signDirect.
- `create-qorechain-dapp` templates `foundry` (`pnpm window` registers the ML-DSA key and opens the EVM window before deploy; works for contract deploy), `viem-wagmi`, `fullstack-web` (Vite `/lcd` proxy). Example: `authenticator-spend` in the SDK repo; `examples/register-and-send` and `examples/siwq-server` in the QoreSign repo.
- `classifyEvmWindowRejection`, `decodeTxError` give friendly failure kinds for the agent/relayer.
- MCP `get_pq_status` for agents; `@qorechain/handlesVerified` for @handle resolution; `@qorechain/qoreseal` (also Python, Go, Rust, Kotlin, Swift) for sealing.
- QoreX developer kit: "six npm packages, published at 0.1.0" on a "QoreX integrations" page (not in my files) that is the dApp-side wallet path.
- Dashboard "Connect with QoreX" bridge (`dashboard.qorechain.io` only): `executeRequest` kinds are only send/delegate/undelegate/redelegate/claim; not usable for our messages.

### 5. Contradictions with our spec

(I only have the brief's description, not the spec text. Items to check against the spec lines.)
- "owner signs orders in the QoreX wallet (signArbitrary)": the docs say `signArbitrary` is NOT supported in QoreX, extension or mobile ("signArbitrary (message signing) is not supported", qorex__browser-extension; "Message signing (signArbitrary) is not shipped", qorex__overview). The only owner-signing paths in QoreX are `signAndBroadcast` (native tx; ML-DSA layer added by wallet) and `signDirect`. An ML-DSA-87 order signature for `pqcVerify` must be produced by another route: QoreSign (`signMessage`/raw ML-DSA with own domain prefix) holding the mnemonic, or a transaction-based approval (for example a signAndBroadcast memo or a tx message) that the vault/backend verifies from chain data. Consider carrying the order inside a Native-lane tx the owner signs in QoreX, and have the verifier use the ML-DSA key registered on chain.
- "operator ... scoped EVM window that only the owner can open/renew" via QoreX: QoreX cannot open a scoped window (no screen), cannot sign EVM, and signAndBroadcast's acceptance of `MsgOpenEVMWindow` with `allowed_targets` is undocumented (decode support unknown). Plan to open scoped windows with the SDK/CLI (`openEvmWindowMsg`, `qorechaind tx pqc open-evm-window --allowed-targets`) from a process holding the owner's key.
- "QoreX browser extension (popup, v0.4.x) testnet": docs list 0.3.8/0.3.9 and document no extension testnet switch (mobile only).
- The authenticator doc shows `perTxLimit/dailyLimit/allowedDenoms`, not `allowed_evm_calls`/`denom_limits`: verify field names against the abstract-account chain docs before coding; the doc also warns that a rule that is "enabled:false" means NO limit.
- "operator account holds only its classical key": hybrid rule means any Native-path tx (including opening the window, KEM registration, authenticator linking) from that account must also carry its ML-DSA signature; only EVM-lane txs inside the window can be classical-only. A coin-118 operator cannot be used with MetaMask-style EVM signing; its EVM account is the coin-60 form (`deriveUnifiedAccount`, or `toQorAddress/toEvmAddress`).


## Digest C: developer-tools (15 files, all read in full)

Spec lines are quoted from qredit-design.md. Not found in this group: `denom_limits`, `allowed_evm_calls`, `msg.sender` semantics of MsgExecuteEVM, pqcVerify ABI/gas/message prefix, fUSD, block time, window renewal rules. Those live in other doc sections.

### 1. Facts we rely on: confirmed or contradicted

**QoreX (developer-tools__qorex-integrations, wallet-adapter)**
- CONTRADICTS spec line 75 ("QoreX `signArbitrary` ... Owner signs policy orders in the wallet"). Live store builds (mobile 1.1.8, extension 0.3.8, Firefox 0.3.9) "do not support signArbitrary". Connectors throw `QOREX_NOT_SUPPORTED_YET`. Message signing "(ADR-36 plus ML-DSA-87)" is only "planned by the QoreX team". Spike S3 fallback (owner CLI with `@qorechain/qoresign`) is the right default.
- QoreX EVM today: only `eth_chainId`, `eth_accounts`, `eth_requestAccounts`, `wallet_switchEthereumChain`. `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction` fail with "QoreX: EVM method ... not yet supported". No `accountsChanged`/`chainChanged` events (RainbowKit option `pollAccountsOnFocus`).
- Testnet switch: "The user changes the network inside QoreX; the dApp cannot switch it." `chainId` in the request must equal the selected network. QoreX serves only qorechain-vladi and qorechain-diana.
- `window.qorex.native.signAndBroadcast({chainId, messages:[{typeUrl, value: protobuf bytes}], memo, gasLimit})` returns `{txHash, code, height, shield}`. Limits: 1 to 32 messages, memo up to 256 bytes, gasLimit clamped 100,000 to 5,000,000 (400,000 default). QoreX prices at 0.15 uqor/gas. Needs extension 0.3.5 or app 1.1.5; detect with `hasCapability(native,"signAndBroadcast")`. `shield` values: shielded, pending, downgraded (alert), classical.
- Refused from pages, also inside authz MsgExec (wallet-adapter 0.5.0+): MsgRegisterKEMKey, MsgRemoveKEMKey, MsgRegisterAuthenticator, MsgRevokeAuthenticator, MsgUpdateSpendingRules, MsgCreateAbstractAccount, MsgOpenEVMWindow, MsgCloseEVMWindow, MsgAuthorizeEVMDelegation, MsgClearEVMDelegation, MsgRegisterPQCKey/V2, MsgMigratePQCKey, MsgRotatePQCKey, MsgRegisterPQCMultisig. "Those stay on QoreX's own screens." This answers spike S2: a buyer cannot register a KEM key from our web app through QoreX. Our script fallback is needed. The owner also cannot open or renew the operator's window from our page via QoreX. It must be QoreX's own screens, our owner CLI, or a script using SDK/QoreSign.
- QoreX `signDirect` throws `QOREX_USE_SIGN_AND_BROADCAST` on QoreChain ids (no hybrid layer added yet). Amino is refused (`QOREX_AMINO_REFUSED`).

**EVM window (chain-dev-sdk, custody-kit, wallet-adapter)**
- Bounds: blocks 1 to 17,280; max_txs 1 to 1,000; max_value in uqor must cover value plus max fee (gas limit x fee cap) of every admitted tx; `nativeOnly`; `allowedTargets` at most 16. A target-restricted window "refuses contract creation".
- Type URLs: `/qorechain.pqc.v1.MsgOpenEVMWindow`, `MsgCloseEVMWindow`. State: `GET /qorechain/pqc/v1/evm_window/{address}` (qor1 or 0x). Opening replaces any earlier window and advances the sequence, which is the EVM nonce ("open the window, then read the nonce"). Wait about 10 s after opening before the first tx (Hardhat README).
- Rejections: pqc code 26 (no window or no key), 27 (exhausted or out of scope), 28 (invalid params). Helper `classifyEvmWindowRejection` gives no-pqc-key, no-window, exhausted, invalid.
- Window scope fields added in chain v3.2.8: `validators`, `stakingValidators`, `ibcReceivers` (wallet-adapter 0.6.0, SDK 0.14.0). Testnet now runs v3.2.9 (since 20 Nov); mainnet v3.2.8.
- "Windows bound only classically signed EVM-lane transactions; hybrid-signed Cosmos messages (cross-VM calls, authz) are outside them" (custody-kit). `allowed_targets` limits which contracts, not how much: "a listed token admits any amount, including approve". Matters for the operator window: it constrains target, so the vault's own `deliver`/`decline` checks must bound the amounts.

**pqc precompiles**
- `pqcVerify` 0x…0A01 and `pqcKeyStatus` 0x…0A02: "active on testnet only"; inactive precompile "returns empty data rather than reverting", so check `active_static_precompiles` at `/cosmos/evm/vm/v1/params` (chain-dev-sdk, mcp). Testnet also lists 0x0C01 rlConsensusParams.
- `pqcKeyStatus(address) returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)`; ML-DSA-87 is algorithm id 1. An older three-field layout exists, so decode strictly (asset-kit). Keys: public 2,592 bytes, signature 4,627 bytes (pqc-library). Signing is FIPS 204 pure mode, empty context (custody-kit, pq-light-client). pqcVerify ABI, gas and prefix are not in this group.

**QoreSeal (developer-tools__qoreseal)**
- Registry live on testnet. `GET /qorechain/pqc/v1/kem/{address}` (qor1 or 0x) returns `{found, key:{address, algorithm_id, algorithm_name, public_key, registered_height}}`, or `{"found":false,"key":null}`.
- `/qorechain.pqc.v1.MsgRegisterKEMKey {sender, algorithm_id=2, public_key}` and `MsgRemoveKEMKey`. Only the sender can register. It needs a registered ML-DSA-87 key and a hybrid signature (QoreSign `signHybrid`). One key per account; re-registering replaces it. Refusals in codespace pqc: 250 registry not enabled, 251 invalid key, 252 none published, 253 already published, 254 needs PQ key. `describeKemRegistryError`.
- Cards: about 6.7 KB JSON, X25519 key bound to the on-chain ML-KEM key, signed with QoreSign message signing. Registering a new ML-KEM key retires old cards. Without a card use `mode:"mlkem"`.
- Envelope: 1 to 1,024 recipients, size `56 + 1,664 x recipients + plaintext` (hybrid). Text form `qoreseal:` + base64url. Chain id and purpose are not in the envelope, so both sides must pass the same values (`DECRYPTION_FAILED` otherwise).
- TS network helpers: `@qorechain/qoreseal/network` (`fetchKemKey`, `resolveRecipient`, `sealToAddresses`). Node 20+. `deriveSealKeys({mnemonic})` index 0, `signRecipientCard`, `recipientCardText`/`assembleRecipientCard` for wallet-signed cards.

**MCP (developer-tools__mcp)**
- 14 read-only tools: get_chain_info, get_block, get_transaction, get_address_info, get_pq_status, get_validators, get_staking_tiers, search, read_contract (eth_call only), estimate_fee, simulate_tx, prepare_transfer, get_token_holders (always NOT_AVAILABLE_ON_CHAIN), request_faucet (always NOT_AVAILABLE_ON_CHAIN). Version 0.1.0.
- `get_pq_status` for an address returns registered key, algorithm, proof of possession and the EVM window. For a tx it checks exactly one hybrid layer and verifies it. `get_chain_info` shows active EVM precompiles and `exact_gas_simulation`.
- Run: `npx -y @qorechain/mcp` (stdio), `npx @qorechain/mcp serve --port 8787` (POST /mcp, GET /healthz), or `uvx qorechain-mcp`. Default network testnet. The hosted https://mcp.qorechain.io/mcp needs an API key (10 req/s, burst 20, 100,000/day). Local needs none.
- Errors: NOT_FOUND, INVALID_INPUT, UPSTREAM_UNAVAILABLE, NOT_AVAILABLE_ON_CHAIN, RATE_LIMITED, UNAUTHORIZED, INTERNAL_ERROR. Input resembling a mnemonic or bare 32-byte key is rejected before any request.

**Authenticators (wallet-adapter 0.6.0)**
- Builders: `registerAuthenticatorMsg`, `registerEthAuthenticatorMsg` (MetaMask), `buildPhantomExecuteEvm`/`Cosmos`, `buildMetaMaskExecuteEvm`/`Cosmos`, `revokeAuthenticatorMsg`, `updateSpendingRulesMsg`, `linkAuthenticatorMsgs` (rule + link in one owner-signed tx). `evmAuthSignBytesV2` (chain v3.2.3+) binds the call's gas limit, which must be non-zero. "The nonce is the linked key's authenticator sequence, not the account's EVM nonce"; "No query exposes the linked key's authenticator sequence yet", so track it; wrong value gives `abstractaccount` code 11.
- 0.6.0 (chain v3.2.8): `possessionProof` is required for linking (`authenticatorLinkMessage`, `phantomPossessionProof`, `metaMaskPossessionProof`). A key with send/evm/deploy/svm/all permission needs the account's first enabled spending rule to bound every denom, or `linkAuthenticatorMsgs` refuses. Rule shape: `{enabled, perTxLimit, allowedDenoms}`. `rules` replaces all rules wholesale.
- "The authenticator module is enabled on testnet and switched off on mainnet" (wallet-adapter limits). Confirms the abstract-account module is on for testnet.
- `authenticatorExecutionResults`/`assertAuthenticatorExecutionsSucceeded`: success=false can hide inside a code 0 tx. ed25519 key scheme = the Phantom path (S1 question: which scheme works with `evm`). Not answered here.

### 2. APIs and exact names

- Endpoints (testnet qorechain-diana, EVM 9800): REST https://api-testnet.qore.host, RPC https://rpc-testnet.qore.host, EVM https://evm-testnet.qore.host, WS wss://evm-ws-testnet.qore.host, SVM https://svm-testnet.qore.host, explorer https://explore.qore.network. Fee floor 0.1 uqor/gas. 1 uqor = 10^12 wei.
- SDK 0.14.0 (all of @qorechain/sdk, evm, react, svm, create-qorechain-dapp): `openEvmWindowMsg`, `fetchEvmWindow`, `EthNativeSigner`, `deriveUnifiedAccount`, `authorizeEvmDelegationMsg`. `@qorechain/evm`: viem chains `qorechainTestnet`/`qorechain`, `QORECHAIN_CHAINS`, `evmWindowStatus` (returns found, live, remainingBlocks, remainingTxs, remainingValue, nativeOnly, allowedTargets), `openEvmWindowMessage`, `evmWindowCost`, `weiToUqorCeil`, `toQorAddress`/`toEvmAddress`, `PRECOMPILE_ADDRESSES`, subpath `@qorechain/evm/window`.
- Applied plan check: `GET /cosmos/upgrade/v1beta1/applied_plan/{v3.2.0|v3.1.98|v3.2.5}`. Sign-bytes v2 domain `qorechain-pqc-hybrid-v2`; pqc code 21 means hybrid verification failed.
- Gas: after v3.2.5 simulation includes ML-DSA cost, so `ceil(gas_used x 1.02) + 2000`. A hybrid tx is about 4.7 KB larger.
- Chain errors (custody-kit): sdk 3 sequence mismatch, 4 unauthorized, 5 insufficient funds, 11 out of gas, 13 insufficient fee, 19 in mempool; pqc 7, 20, 21, 26, 27, 28; abstractaccount 11.
- Test ERC-20 on testnet: 0x9C2F20329750c16B215bDc50455d320De2a7Ba1c (WQOR, 18 dec). Faucet account 0xf1e70c24817e00aee286f7275e14e61cabd20741. No fUSD anywhere in this group.
- Key derivation: ML-DSA-87 key = SHAKE-256("qorechain:pqc:v1|"+address+"|"+mnemonic), shared by SDK, wallet-adapter, chain-bridge, QoreX, `qorechaind tx pqc recover-key`. Recovery codes `QRC1-...` for PRIVATE_KEY accounts (`generatePqcRecoveryCode`, `pqcKeyFromRecoveryCode`). Template env: `QORE_MNEMONIC`, `QORE_PQC_RECOVERY_CODE`, `QORE_WINDOW_BLOCKS/TXS/MAX_UQOR`.
- Dashboard faucet needs sign-in. The qorollup faucet needs `QORE_FAUCET_URL`.

### 3. Gotchas and limits

- cosmjs conflict: wallet-adapter and chain-bridge use cosmjs 0.32, the SDK uses 0.39. One project with both gives ERESOLVE (`--legacy-peer-deps` or separate packages). Qredit needs SDK 0.14.0 and likely wallet-adapter for authenticator and metamask/phantom builders. Isolate the authenticator setup script in its own workspace package. Bun resolution is untested in the docs.
- Public REST sends no CORS headers (viem-wagmi and fullstack-web templates proxy via Vite `/lcd`). Our Next.js app needs a server-side proxy or route handler for REST.
- Testnet history is pruned (lowest height 8,790,799 when checked). Old demo txs return NOT_FOUND. Record tx hashes and screenshots right after the demo run, and re-run the final demo close to judging.
- Public endpoints are rate-limited and meant for development. If a script gets 403, set an explicit User-Agent. Testnet runs v3.2.9; wallet-adapter 0.6.0 was not written against it. Re-check the authenticator and window flows after any upgrade.
- EVM differences: no debug_*/trace_*, `eth_sendTransaction` refused (sign locally), `eth_getLogs` max 10,000 blocks, `eth_subscribe` over WS only, `txpool_content` refused. PREVRANDAO constant. No blob txs. Types 0/1/2/4 accepted. Blocks are final on commit (latest = safe = finalized). `eth_getBalance` = uqor x 10^12 plus remainder.
- Foundry sets fee cap about 2x base fee (up to about 200 gwei committed against the window, while paying about 112.5 gwei). Size operator `max_value` with `evmWindowCost`, using the real fee cap.
- A failed EVM execution can still report native code 0. For MsgExecuteEVM the same applies to `success=false`. The relayer must read the execution result (`assertAuthenticatorExecutionsSucceeded`) and not just the tx code.
- Run one signer queue per signer (sequence mismatch code 3). Re-simulate gas, then re-sign.
- QoreSeal is pre-1.0 and its construction is pending review. Envelopes are not signed, and every recipient reads the whole payload. Python has no Windows wheel. Key loss means data loss. Hints are not anonymity.
- Mock wallet announces `network.qore.qorex.mock`, so strict discovery finds no EVM provider under the mock. Use `QOREX_MOCK_RDNS`.
- Hosted MCP key is per account and takes minutes to activate. Prefer local stdio for Mastra.
- Mainnet precompiles inactive, so Qredit is testnet-only (matches spec).

### 4. Opportunities

- **QoreSeal auditor recipient**: add a judge/auditor key as an extra recipient in envelopes ("auditor (view) key", a key pair kept in configuration, one per quarter via `deriveSealKeys` index). A judge can then decrypt a published sample report without the buyer key.
- **Dashboard Developers page** (dashboard.qorechain.io/developers): Transaction inspector (paste hash, see signer, fee, whether the PQ layer verifies, tier), PQ key status (key plus EVM window for any address), Simulator, Signing playground. Link these in the verification guide for judges.
- **CLI**: `qore pq status <hash|address>`, `qore read-contract --to <vault> --function ... --json`, `qore search`, as copy-paste judge verification commands.
- **QoreScan** (`npx @qorechain/qorescan scan --network testnet --address qor1... --solidity ./contracts`): inventories pqcVerify/pqcKeyStatus use with file+line, plus each account's PQC key status, as a CycloneDX CBOM. A GitHub Action produces it as an artifact. Good evidence for the "Post-quantum correctness" criterion.
- **asset-kit contracts**: `QoreChainHybridHolderGuard` shows strict decoding of `pqcKeyStatus` with a fixed gas allowance and fail-closed behaviour. It ships a 33-test Foundry setup using a "test double of the precompile". Reuse it for vault tests and invariants. QoreScan also mentions `IQorePQC.sol` as the signature-library interface name.
- **@qorechain/qorex-wallet-mock + qorex-synpress**: Playwright fixtures for web e2e with real hybrid signing on testnet (own funded mnemonic). `profile:"planned"` previews signing methods.
- **create-qorechain-dapp --template foundry**: provides `pnpm window status|register|open|recovery-code`, a foundry.toml with `qorechain_testnet`, and `viem-wagmi` (QoreX + RainbowKit + window badge). Borrow code instead of writing window tooling.
- **@qorechain/react `PqcStatusBadge`** ("PQC key registered"): quick UI proof of keys.
- **MCP `get_pq_status`** for agent read tools: window status without custom REST code. `simulate_tx` returns decoded refusals, useful for the attack gallery. `read_contract` gives vault views.
- **custody-kit** `decodeTx`/`verifyTx`/`extractDeposits`: reference code for the relayer's pre-broadcast check and for deciding whether a MsgExecuteEVM really succeeded.
- `@qorechain/pqc` (pure JS, ML-DSA-87 sign about 8 ms; deterministic by default; hedged also accepted by chain) for scripts and tests.

### 5. Contradictions with the spec

- Spec l.75: "QoreSign / QoreX `signArbitrary` | Owner signs policy orders in the wallet". Doc (qorex-integrations): live builds "do not support signArbitrary"; "signArbitrary throws QOREX_NOT_SUPPORTED_YET". Planned only. Design around spike S3 fallback; keep the "wallet signs" story out of the demo unless QoreX ships it.
- Spec l.193: owner signs "through QoreX `signArbitrary` ... prefixed bytes `qorechain-msg-v1|` + chainId + `|` + data (confirmed in spike S3)". Not documented here, and the signing method is unavailable in store builds. Verify the QoreSign message-signing path (not in this group).
- Spec l.45/131 ("renewable only with the owner's hybrid (ML-DSA-87) signature"): consistent with the docs (window opened by hybrid-signed MsgOpenEVMWindow), but QoreX pages cannot send MsgOpenEVMWindow, so renewal needs the owner CLI or QoreX's own screens.
- Spec S2 (buyer registers KEM key from web with QoreX): docs say MsgRegisterKEMKey is refused for pages, so the fallback "demo buyers created by script" is the expected outcome.
- Spec l.131 ("runtime holds only the operator's classical private key"): docs say an account with a registered key has "no classical path" on the native lane and EVM sends need that account to have a registered ML-DSA-87 key plus an open window. The operator account must therefore have its ML-DSA-87 key registered (once) and the window opened by hybrid signature from the owner. Check the operator is an account whose ML-DSA key is owned by the owner (not held at runtime).
- Spec "Bun": docs target Node 20+ (QoreSeal, SDK) and mention only npm/pnpm/yarn in scaffolders. No contradiction, but untested.


## Qredit digest, QoreChain docs group D

Scope: the 35 assigned files (build-before-qday*, dashboard*, getting-started*), all read in full. Targeted searches into developer-guide__account-abstraction.txt, developer-guide__evm-window-reference.txt, developer-guide__evm-precompiles.txt, developer-guide__evm-development.txt (not read in full), developer-tools__qorex-integrations.txt, developer-tools__mcp.txt, developer-tools__qoreseal.txt, qorex__browser-extension.txt and qoresign__spec__message-signing-v1.txt. File names are in the clean/ folder.

### 1. Facts we rely on

**Confirmed**
- Testnet qorechain-diana, EVM chain 9800, REST https://api-testnet.qore.host, EVM RPC https://evm-testnet.qore.host. Testnet runs v3.2.9 since 20 Nov 2026 (build-before-qday__prerequisites.txt, getting-started__connecting-to-testnet.txt).
- Precompiles are active on testnet only: `0x...0a01` pqcVerify, `0x...0a02` pqcKeyStatus (developer-guide__evm-precompiles.txt; build-before-qday__workshop-2.txt). Signatures: `pqcVerify(bytes pubkey, bytes signature, bytes message) returns (bool)`, about 85k to 90k gas. `pqcKeyStatus(address)` costs 2,500 gas and returns `(bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)`. The fourth output exists from v3.2.4. A call to an inactive address succeeds with empty data, so check the length of raw return bytes (developer-guide__evm-precompiles.txt).
- Sizes: ML-DSA-87 public key 2,592 bytes, signature 4,627 bytes (build-before-qday__key-binding.txt, build-before-qday__workshop-1.txt).
- EVM window: `MsgOpenEVMWindow` and `MsgCloseEVMWindow` are Native-lane, hybrid-signed, and need a registered ML-DSA key. Bounds: blocks 1 to 17,280, txs 1 to 1,000, max-value > 0 (developer-guide__evm-window-reference.txt; getting-started__first-transaction.txt). Max-value counts each tx's value plus gas limit times fee cap. Opening replaces the previous window and advances the nonce. A window ends when any bound runs out. Read it at `/qorechain/pqc/v1/evm_window/{addr}` (found, live, remaining_*) (build-before-qday__workshop-1.txt; dashboard__wallet.txt).
- Authenticators (testnet only, module disabled on mainnet): `MsgExecuteEVM` exists. The relayer is the signer and fee payer. The authenticator signs `sha256("qorechain-evm-auth-v2" || ... || nonce || gasLimit)`. The nonce is the linked key's own sequence, not the account's EVM nonce. Permissions include `evm`. Rules can set `allowed_evm_calls` (`0x<target>/0x<selector>`), `allowed_denoms`, `daily_limit`, `per_tx_limit` and `denom_limits`. A key with value permissions is refused at registration without a rule (code 8). A relayer's own hybrid signature is needed (developer-guide__account-abstraction.txt).
- fUSD `0x97143B771D34ddb9130b807b135Ae675A5a963CA`, 6 decimals, ERC-20 on testnet (dashboard__faucet.txt).
- Faucet per claim: 100 QOR, 1000 fUSD, 0.5 fETH, 0.02 fBTC. Cooldown 24 h per account and per address. Sign-in required. The form rejects 0x input. A fest-token send can fail while the QOR still arrives (dashboard__faucet.txt).
- MCP `@qorechain/mcp` 0.1.0: 14 read-only tools, never signs. Local stdio needs no key. The hosted endpoint needs a key (developer-tools__mcp.txt; build-before-qday__workshop-2.txt).
- `qore pq status <hash|address>` reports tier (pqc or classical, reason evm_lane) and verification (build-before-qday__workshop-2.txt).
- QoreSeal: `MsgRegisterKEMKey` is hybrid-signed and needs a registered ML-DSA key. Query `GET /qorechain/pqc/v1/kem/{address}`. ML-KEM-1024 public key 1,568 bytes. Recipient card about 6.7 KB, signed with QoreSign message signing. Chain id and purpose enter the key derivation (developer-tools__qoreseal.txt; build-before-qday__workshop-3.txt).
- Dashboard: Developers page has PQ key status, Transaction inspector (QoreSign inspectTransaction 0.1.1), Simulator (dry-run only, base64 or hex TxRaw), and a QoreX mock wallet (EIP-6963 "QoreX (mock)"). Network toggle defaults to Testnet (dashboard__developers.txt). Contract Auditor returns a 0 to 100 score plus a PQ readiness percentage; the first audit each UTC day is free (dashboard__contract-auditor.txt).

**Not confirmed, or contradicted**
- QoreX `signArbitrary`: not supported. `qorex__browser-extension.txt` says "signArbitrary (message signing) is not supported". `developer-tools__qorex-integrations.txt` says it throws QOREX_NOT_SUPPORTED_YET. See section 5.
- The `qorechain-msg-v1|` prefix is confirmed only in QoreSign's message-signing spec (`qoresign__spec__message-signing-v1.txt`), not in the QoreX section.
- `MsgExecuteEVM` gas figures and the explorer label for authenticator-driven EVM calls: not documented.
- Browser registration of an ML-KEM key: no documented route. The only documented browser route is `signAndBroadcast` with an arbitrary typeUrl; QoreX refuses message types it cannot display (developer-tools__qorex-integrations.txt). Untested.
- Authenticator spending limits in the examples use `uqor` only (build-before-qday__workshop-2.txt). The `erc20/0x...` denom form is documented in developer-guide__account-abstraction.txt.

### 2. APIs and exact names

- REST: `/qorechain/pqc/v1/account/{addr}` (found, possession_proven); `/qorechain/pqc/v1/evm_window/{addr}`; `/qorechain/pqc/v1/kem/{addr}`; `/qorechain/abstractaccount/v1/{config, accounts/{addr}/spending_rules, accounts/{addr}/authenticators, auth_nonce/{addr}/{pubkey_hex}, permission_schema}`; `/cosmos/tx/v1beta1/txs/{hash}`; `/cosmos/tx/v1beta1/txs?query=ethereum_tx.ethereumTxHash='0x...'` (find the native ID of an EVM tx, dashboard__explorer.txt); `/cosmos/bank/v1beta1/denoms_metadata`; `/qorechain/amm/v1/pools`.
- Messages: `/qorechain.pqc.v1.MsgRegisterPQCKeyV2`, `MsgOpenEVMWindow`, `MsgCloseEVMWindow`, `MsgRegisterKEMKey`, `MsgRotatePQCKey`; extension `/qorechain.pqc.v1.PQCHybridSignature`; event `pqc_hybrid_verify` with `status=verified`.
- Errors: "account has no PQC key and classical fallback is disabled"; "no open EVM authorisation window" (pqc 26); "does not admit this transaction" (pqc 27); invalid window (pqc 28); authenticator code 8 (rule needed), 10 (permission denied), 11 (stale nonce). KEM refusals 250 to 254 (developer-tools__qoreseal.txt).
- SDK helpers that replace code we planned: `@qorechain/evm`: `evmWindowStatus`, `evmWindowCost`, `classifyEvmWindowRejection` ("no-pqc-key" | "no-window" | "exhausted" | "invalid"), `qorechainTestnet`. `@qorechain/sdk`: `openEvmWindowMsg({sender, blocks, maxTxs, maxValue, nativeOnly, allowedTargets})`, `closeEvmWindowMsg`, `fetchEvmWindow`, `ensurePqcRegistered`. `@qorechain/qorex-rainbowkit`: `qorexWallet({pollAccountsOnFocus})`. `@qorechain/qorex-types`: `getQorexNative`, `qorexSignAndBroadcast({chainId, messages:[{typeUrl, value}], memo})` returns `{txHash, code, shield}`. `@qorechain/qoreseal`: `deriveSealKeys`, `signRecipientCard`, `verifyRecipientCard`, `sealToAddresses`, `open`, `buildRegisterKemKeyMessage`.
- Sign with `window.qorex.native.signAndBroadcast` after checking `hasCapability(native, "signAndBroadcast")`.

### 3. Gotchas and limits

1. **Deploys need an unscoped window.** `--allowed-targets` and `--native-only` refuse contract creation (developer-guide__evm-window-reference.txt; getting-started__deploy-in-5-minutes.txt). Workshops 2 and 3 deploy right after `window:scoped`, which conflicts with this. Open a plain window to deploy the vault, then open the scoped one.
2. **"Value 0" is not possible for the operator window.** `max-value` must be > 0 and must cover gas limit times fee cap per transaction. A 3M-gas deploy counts about 0.64 QOR (getting-started__deploy-in-5-minutes.txt). The operator's budget must include fees.
3. **Window length ceiling.** 17,280 blocks is about 6 h on testnet at about 1.3 s per block (getting-started__connecting-to-testnet.txt). Winners are due 16 Dec, so the operator window must run from 2 Dec to 16 Dec, about 14 days, roughly 930k blocks and about 54 renewals. Each renewal advances the nonce. An in-flight operator tx signed before a renewal fails with "nonce too low" (getting-started__deploy-in-5-minutes.txt).
4. **Faucet fUSD is a bank coin.** The faucet pays `erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA`, case-sensitive. The ERC-20 balance needs `MsgConvertCoin` first (dashboard__faucet.txt). Lenders and buyers must convert before any vault call.
5. **No AMM pools on either network** (checked 27 Oct 2026; dashboard__trade.txt). Do not plan a test-QOR to fUSD swap.
6. **Refusals inside a successful tx.** From v3.2.8 a failed `MsgExecuteEVM` returns tx code 0 with `success=false` in the response and emits `abstractaccount_execution_failed`. The attack gallery must read that response or event (developer-guide__account-abstraction.txt). Workshop 2 shows the same for bank sends.
7. **Explorer lookups.** An EVM `0x` hash works only in the Dashboard explorer with the network set to Testnet. explore.qore.network does not find EVM hashes. A 0x address in Dashboard search gives "Transaction Not Found" (dashboard__explorer.txt).
8. **Audit reports are private by default**, and a private report cannot be opened even with the link. The owner must set Public for judges (dashboard__contract-auditor.txt). The auditor reads pasted source only. Solidity PQ readiness shows "Not scored" (build-before-qday__workshop-2.txt).
9. **No CORS on public REST.** A browser page must call through a server-side proxy (build-before-qday__workshop-1__apps__qday-guestbook.txt; build-before-qday__prerequisites.txt).
10. **Testnet history is pruned.** Old transactions return NOT_FOUND (developer-tools__mcp.txt; dashboard__developers.txt). Judges may not be able to check old proofs.
11. **Key rotation changes old verdicts.** The inspector checks against the currently registered key (dashboard__developers.txt).
12. **Proof of possession is optional on chain.** Check `possessionProven` in the vault, which the spec already does (developer-guide__evm-precompiles.txt).
13. **Faucet quota.** Each account and address gets one claim per 24 h. Owner, spender, operator, relayer, lenders, buyers and suppliers each need one.
14. **Relayer must be hybrid-signed.** The relayer's own ML-DSA key must be registered and it must sign hybrid (developer-guide__account-abstraction.txt).

### 4. Opportunities

- Use `classifyEvmWindowRejection`, `evmWindowStatus` and `evmWindowCost` from `@qorechain/evm`. The Guestbook web page shows the pattern (build-before-qday__workshop-1__apps__qday-guestbook.txt).
- For dApp writes, QoreX offers to register the key and open the window inside the same approval (Guestbook step 9). This could serve buyers (spec S4). QoreX windows use the defaults (300 blocks, 5 txs, 1 QOR) and QoreX has no scoped-window screen yet (dashboard__wallet.txt).
- Developers page tools for judges: PQ key status (registered, proven, window state), Transaction inspector (PQC or classical tier per tx) and Simulator (dry-run). The QoreX mock wallet (qorex-wallet-mock) lets the web app run without a real wallet (dashboard__developers.txt; developer-tools__qorex-integrations.txt).
- `npx -y @qorechain/qore-cli pq status <hash>` and the MCP tool `get_pq_status` give a judge one-line proof of the owner's ML-DSA layer (build-before-qday__workshop-2.txt; developer-tools__mcp.txt).
- Workshop 2 `02-pq-agent` is a reusable reference: separate gas wallet, `link` with rules, and `rules` to read back the on-chain limits (build-before-qday__workshop-2.txt).
- Build Before Q-Day Advanced track A (agents) and track B (QoreSeal) fit Qredit (build-before-qday__overview.txt). Submission by 2 Dec 2026 23:59 UTC needs a public repo, a video of up to 3 minutes and the testnet addresses in use, so list the vault and agent addresses in the README.
- Dashboard explorer shows "Authorised by a PQC window" on EVM transactions, with a link to the window-open transaction (dashboard__explorer.txt). Judges can follow vault calls back to the owner's signature.
- Two-stage audit with the Contract Auditor (audit draft, fix, audit final) is the Workshop 2 pattern (build-before-qday__workshop-2.txt).

### 5. Contradictions with the spec

- **Spec sections 2-3 and line 75, and the owner flow.** The spec says the owner signs policy orders in QoreX through `signArbitrary`. The docs say QoreX does not support `signArbitrary` (qorex__browser-extension.txt; developer-tools__qorex-integrations.txt). The only documented route is QoreSign message signing from the owner CLI (qoresign__spec__message-signing-v1.txt), which is the spec's own fallback (S3). The "owner signs in QoreX" claim must be dropped or marked unavailable.
- **Operator window "value 0"** (spec line 45, 72). Docs require `max-value > 0` covering fees (developer-guide__evm-window-reference.txt).
- **Operator renewal.** Spec line 137 needs the window open from the deadline until winners are announced. Docs cap a window at 17,280 blocks (about 6 h on testnet). About 54 renewals (see gotcha 3).
- **Deploy inside a scoped window.** The spec does not state this, but Workshops 2 and 3 do it and the window reference forbids it (see gotcha 1).
- **Relayer and ML-DSA.** Spec line 132 has the relayer forwarding `MsgExecuteEVM`. Docs require the relayer to be hybrid-signed with a registered key (developer-guide__account-abstraction.txt). Missing from the spec.
- **Spending-rule ordering.** Spec section 3 links the key and sets rules. Docs require the rule first, or in the same transaction (developer-guide__account-abstraction.txt).
- **Pool 2** (spec S5). Docs say no pools exist on either network (dashboard__trade.txt). The faucet is the only fUSD source.
- **SDK version.** Spec says `@qorechain/sdk` 0.14.0. The Dashboard lists 0.13.0 as current since 11 Nov (dashboard__developers.txt). 0.14.0 appears only in the Workshop 1 package table and in the window reference, where it adds the validators lists (developer-guide__evm-window-reference.txt). Pin and test the version actually used.
- **Authenticator limits in denoms.** Spec line 130 says per-denom limits. Docs document `denom_limits` with `erc20/0x...` (slash form), not the bank form `erc20:0x...` (developer-guide__account-abstraction.txt). Use the slash form in rules.
- **Unverified spec claim.** "Ship Weeks badges ... claim from My space" (spec line 82) appears nowhere in the group D docs. Badges are a 12-series catalogue with a "Check Badges" button (dashboard__quests.txt).


## Digest E: QoreChain docs (api-reference, cli-reference, appendix, user-guide, introduction)

All 29 files read in full (clean\ folder). Spec checked: D:\Coding\orca-workspace\qorechain\docs\superpowers\specs\2026-11-24-qredit-design.md (targeted lines only). Testnet = qorechain-diana, EVM chain 9800. Docs snapshot is as of about 22 Nov 2026.

### 1. Facts we rely on (confirmed / not confirmed)

- **Testnet status.** Testnet runs v3.2.9 since 20 Nov 2026 (height 10,424,000). Mainnet runs v3.2.8. `api-reference__rest-grpc-endpoints.txt`, `appendix__version-history.txt`.
- **qor_ namespace.** Served on testnet from v3.2.9, and on mainnet returns -32601. Use REST for anything that must work on both. `api-reference__json-rpc-qor_-namespace.txt`.
- **Abstract accounts.** Testnet `enabled: true`; mainnet `false`. Probe `GET /qorechain/abstractaccount/v1/config` first. `api-reference__rest-grpc-endpoints.txt`.
- **auth_nonce.** `GET /qorechain/abstractaccount/v1/auth_nonce/{address}/{pubkey_hex}` (v3.2.4, testnet) returns the sequence the linked key must sign next. `accounts/{address}` returns 404 when none exists. `permission_schema` returns the 11-permission taxonomy. `api-reference__rest-grpc-endpoints.txt`.
- **Spending rules and errors.** Per-tx and per-UTC-day value caps, denom allowlists, and key-management messages are never delegable. Error codes: 5 spending limit exceeded, 6 authenticator expired, 10 permission denied, 11 replay rejected. `appendix__version-history.txt` (v3.1.84, v3.1.85).
- **Not documented.** `allowed_evm_calls`, `MsgUpdateSpendingRules`, `MsgRegisterAuthenticator` (only the CLI `register-authenticator` is named), `MsgExecuteEVM` gas, nonce and digest layout, and any ed25519 authenticator for the EVM lane. Docs only describe secp256k1 (33-byte key or 20-byte ETH address via EIP-191); Phantom ed25519 is SVM-lane only. `appendix__version-history.txt`, `cli-reference__query-commands.txt`.
- **EVM window status.** `GET /qorechain/pqc/v1/evm_window/{address}` returns `found, live, opened_height, expiry_height, max_txs, used_txs, max_value, used_value, remaining_blocks/txs/value, native_only, allowed_targets`. No window returns HTTP 200 with `found: false`. v3.2.9 adds `validators, staking_validators, ibc_receivers`. `api-reference__rest-grpc-endpoints.txt`, `appendix__version-history.txt`.
- **Window limits.** Blocks 1 to 17,280; max-txs 1 to 1,000; max-value must be greater than 0 (transferred value plus max fee of each tx); allowed_targets at most 16. Opening replaces any existing window. Closes on expiry, exhaustion, `close-evm-window`, or key rotation or re-registration (v3.2.8). `appendix__chain-parameters.txt`, `cli-reference__transaction-commands.txt`, `appendix__version-history.txt`.
- **EVM admission.** The EVM lane needs a registered PQC key and a live window. Otherwise refused with pqc codes 26, 27 or 28 (27 = outside window scope). A plain EVM wallet cannot send until this setup is done, including buyers. `api-reference__json-rpc-eth_-namespace.txt`, `appendix__faq.txt`.
- **PQC account record.** `GET /qorechain/pqc/v1/account/{address}` returns `found`, `account.key_type`, `algorithm_name`, `possession_proven` (v3.2.4), `classical_key_source`. `found: false` when no key. `api-reference__rest-grpc-endpoints.txt`.
- **KEM lookup.** REST `GET /qorechain/pqc/v1/kem/{address}` (v3.2.5, both networks) returns `{"found":false,"key":null}` when none. `qor_getKEMKey` (testnet only) accepts qor1 or 0x and returns `algorithm_id, algorithm_name, public_key, registered_height`. The registration message is not named in the docs. The only documented route is `tx pqc register-key-v2 <mlkem1024> ...`, and it is not confirmed that this writes to the KEM registry. `api-reference__rest-grpc-endpoints.txt`, `cli-reference__transaction-commands.txt`.
- **Proof of possession.** Optional on account keys. Attached with `register-key-v2 ... --pqc-key <name>`. Per the docs, `@qorechain/wallet-adapter` and SDK releases before 0.9.0 do not attach it, so `possession_proven` stays false. `cli-reference__transaction-commands.txt`.
- **pqcVerify / pqcKeyStatus.** Precompiles 0x...0a01 and 0x...0a02 are active on testnet. The docs give no ABI, gas or message prefix for them. Fixed sizes: ML-DSA-87 signature 4,627 bytes, public key 2,592 bytes (`appendix__glossary.txt`). Precompile input cap is 16,384 bytes (`evm_limits`). Cosmos-lane PQC checks are a flat 2,000 gas from v3.2.7; the docs do not say whether the precompile uses the same charge. `appendix__chain-parameters.txt`, `api-reference__rest-grpc-endpoints.txt`.
- **Gas and fees.** Floor 0.1 uqor per gas on both networks. Fees are uqor only (accepted-token list has uqor only). Suggested: 400k gas / 40,000 uqor for transfers, 600k / 60,000 for PQC key registration, 400k / 40,000 for open-evm-window. Hybrid transfers used 160k to 240k gas. Caps: 50,000,000 per Cosmos tx; 30,000,000 per EVM tx (`evm_limits`). Derived by me: 0.1 uqor/gas = 1e11 wei = 100 gwei (1 uqor = 1e12 wei), and a 30M-gas tx at floor costs 3 QOR. `user-guide__gas-abstraction.txt`, `cli-reference__transaction-commands.txt`, `appendix__networks.txt`.
- **Block time.** Testnet about 1.3 s (measured 27 Oct); mainnet about 3.1 s. Derived: 17,280 blocks is about 6.2 h on testnet. The docs' "about 15 hours" figure is the mainnet one. `appendix__chain-parameters.txt`, `appendix__faq.txt`.
- **Per-sender limit.** 600 Cosmos-lane txs per 30 blocks per sender (about 39 s on testnet). This is the relayer's budget. `appendix__chain-parameters.txt`.
- **Fest tokens.** fUSD bank denom `erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA` (case-sensitive EIP-55), 6 decimals. ERC-20 balance on the EVM side is read with `balanceOf`. Faucet is on dashboard.qorechain.io and sends fUSD with a QOR claim. `api-reference__rest-grpc-endpoints.txt`, `appendix__faq.txt`.
- **AMM.** No pools on testnet as of 27 Oct. Pool creation costs 100 QOR. `api-reference__rest-grpc-endpoints.txt`.

### 2. APIs and exact names

- EVM JSON-RPC: `https://evm-testnet.qore.host`. WS: `wss://evm-ws-testnet.qore.host` (testnet only).
- REST: `https://api-testnet.qore.host`. Consensus RPC: `https://rpc-testnet.qore.host`.
- REST routes: `/qorechain/pqc/v1/{account,evm_window,evm_limits,kem,multisig,params}/...`; `/qorechain/abstractaccount/v1/{config,accounts,permission_schema,auth_nonce/{address}/{pubkey_hex}}`; `/qorechain/crossvm/v1/{params,message/{id}}`; `/cosmos/tx/v1beta1/txs/{hash}`; `/cosmos/tx/v1beta1/simulate`.
- JSON-RPC: `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_estimateGas`, `eth_feeHistory`, `eth_subscribe` (`newHeads`, `logs`, `newPendingTransactions`).
- CLI: `qorechaind tx pqc open-evm-window|close-evm-window|cosign|register-key-v2`; `qorechaind query pqc evm-window|account`; `qorechaind tx abstractaccount register-authenticator`; `qorechaind query abstractaccount permission-schema`; `qorechaind query txs --query "message.sender='...'"`.
- Crossvm and the bridge precompile 0x...0901 are testnet-only, and not needed for Qredit.

### 3. Gotchas and limits

- Rate limit: 1,200 requests per 60 s per IP on testnet hosts. Above that the address is blocked for 60 s. `appendix__networks.txt`.
- `eth_getLogs`: at most 10,000 blocks per query (error -32000 `maximum [from, to] blocks distance: 10000`). Max 16 filters per client. `eth_subscribe` over HTTP returns -32601. `api-reference__json-rpc-eth_-namespace.txt`, `appendix__networks.txt`.
- Disabled on public endpoints: `txpool_content`, `txpool_inspect`, `debug_*`, `eth_signTransaction`. REST `/cosmos/evm/vm/v1/*` (eth_call and estimate) returns 403. Use JSON-RPC `eth_call` and `eth_estimateGas`.
- Python urllib gets 403 by default. Set an explicit User-Agent. Node, Go, curl and requests work as-is.
- Public nodes prune old state, so `eth_call` at distant heights can fail.
- Errors: JSON-RPC -32600, -32601, -32602, -32603. REST 501 means the route is not served (not an empty result). REST 404 means not found. REST 400 means bad input.
- Cosmos hybrid signing is mandatory. Plain `tx bank send` gets codespace pqc code 20. Classical-only key: 230. PoP failure: 231. Key reused: 232. Classical-only attempt by a key holder: 234. Wrong classical key: 45.
- Abstract accounts: linking a key needs PoP, and a key that can move value needs a spending rule (v3.2.8). A rule that bounds nothing is refused (v3.2.5). Key-management messages cannot run through authz.
- PQC key rotation or re-registration closes the EVM window (v3.2.8). The owner must reopen it.
- Window scope: precompile calls are scoped by the EVM window (v3.2.5). Signatures a contract verifies on chain need the verifying contract to be in the window (v3.2.8). Not clear whether this covers `pqcVerify` calls made inside `applyOrder`. Test on testnet.
- The docs say window `allowed_targets` limits recipients, not amounts, and that windows only bound classically signed EVM txs. ERC-20 amounts are therefore not bounded by the window. Whether SpendingRule caps count ERC-20 amounts is not documented.
- Testnet takes each release first. Re-read limits and gas caps before the demo. The testnet manifest still reads 3.2.8 (checked 22 Nov) while the chain runs 3.2.9. A self-hosted node needs the whole `lib/` folder from the bundle.

### 4. Opportunities

- `GET /qorechain/abstractaccount/v1/permission_schema`: validate authenticator scopes without hardcoding them.
- Offline authenticator tools in the abstractaccount CLI: `auth-keygen`, `auth-sign-cosmos`, `auth-sign-evm` (`cli-reference__query-commands.txt`). The seed comes from `--seed-file` or `QORE_AUTH_SEED`, never an argument. Useful for spike S1 and tests.
- `tx pqc cosign --dry-run`, `--generate-only`, `--offline` and `--sign-bytes auto` for the owner CLI.
- WS event subscriptions for the decision log instead of polling: RPC `tm.event='Tx' AND pqc_evm_window_used.address EXISTS` (pattern from docs; not tested for this event). Vault events via EVM `logs` filter (16-filter cap).
- Judge verification: explorer `explore.qore.network` (testnet toggle), `/cosmos/tx/v1beta1/txs/{hash}`, `eth_getTransactionReceipt` (failed EVM tx receipts readable since v3.2.7).
- Gas: `/cosmos/tx/v1beta1/simulate` stays public, so use it to estimate `MsgExecuteEVM`.
- SDK helpers: `@qorechain/sdk` 0.14.0 is current (0.12.0 adds ML-KEM registry builders and reads, plus abstract-account reads; 0.9.0 attaches PoP). `@qorechain/pqc` 0.1.1 does deterministic ML-DSA-87 signing that matches the chain. `@qorechain/wallet-adapter` 0.1.5 has `walletFromSeed`.

### 5. Contradictions with our spec

1. Spec lines 131 and 264: "Scoped EVM window: `allowed_targets = [vault]`, value 0". Docs (`cli-reference__transaction-commands.txt`, `appendix__chain-parameters.txt`): "max-value positive" and "max_value greater than 0". Use a small positive value that covers fees, and let the vault refuse value-bearing calls.
2. Spec line 137 and S6 ("What is the longest window allowed?"): answer is 17,280 blocks, about 6.2 h on testnet. Renewal during judging must happen roughly every 6 h, not every 15 h.
3. Spec line 299 `MsgRegisterKEMKey`: not in the docs. Closest documented route is `register-key-v2` with `mlkem1024`. Check the SDK 0.12.0 KEM builders.
4. Spec line 46 `MsgRegisterAuthenticator` and `MsgUpdateSpendingRules`: docs name only the CLI `register-authenticator`. No update-rules message or `allowed_evm_calls` field is documented.
5. Spec line 192 (owner key "registered and proven") versus docs: QoreX and wallet-adapter registrations carry no PoP, so `possession_proven` stays false and the vault would refuse with `OwnerKeyNotProven`. Register the owner key via the CLI (`register-key-v2 ... --pqc-key`) or SDK 0.9.0 or later.
6. Brief's "linked ed25519 key" versus docs: only secp256k1 is documented for EVM-lane authenticators. Settle with S1.
7. Spec line 194 (`qorechain-msg-v1|` signArbitrary prefix): the docs say nothing about QoreX `signArbitrary`. Not verifiable from the docs.
8. Spec line 73 (`pqcKeyStatus` returns a "registered, proven" key): the docs describe the REST account route, not the precompile ABI. The precompile's return fields are not documented.


