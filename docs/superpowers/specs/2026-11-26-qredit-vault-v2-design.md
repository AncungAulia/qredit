# Qredit vault v2: lender, buyer and owner protection

Changes to `LoanVault` and `VaultFactory` that close the holes found in the persona audit, plus the app changes they force. It extends the main design (`2026-11-24-qredit-design.md`, section 6); everything not named here stays as it is. Off-chain hardening that does not depend on the contract is a separate spec.

## 1. Why

The v1 vault keeps lender money from being spent outside listed suppliers, but:

| # | Hole | Who loses |
|---|---|---|
| K1 | The owner lists an address it controls as a supplier and pays itself from the raised principal, up to the daily cap, without selling anything. | Lenders |
| K2 | There is no maturity and no default. A dead business keeps its cash and unclaimed owner share in the vault forever. | Lenders |
| K3 | The owner claims its share while the loan runs; if the business later fails, the owner is paid and lenders are not. | Lenders |
| K4 | `deliver` splits the buyer's payment at once, whatever the report holds. The buyer has no recourse. | Buyers |
| K5 | `spender` and `operator` are immutable. A lost or leaked agent key ends the business. | Owner, lenders |
| K6 | The factory accepts any token. A vault in a fake token looks like a real one. | Lenders |
| K7 | The owner buys its own service to inflate its order count. | Lenders |

Patterns come from Maple (default after grace), Goldfinch (first loss, lenders first), Wildcat (delinquency), Virtuals ACP and ERC-8183 (escrow with review), and Coinbase Spend Permissions (revoke by either side). No project has a trustless fix for K1 or K7; v2 bounds the loss and says so.

## 2. States

`Raising → Active ⇄ Trapped → Repaid`, `Raising → Refunded`, and two new terminal states:

- **Defaulted**: set by `triggerDefault()` once the loan is far enough behind or past maturity (section 6).
- **Closed**: set by the owner's signed `Close` order.

`state()` stays computed for the time-based states. Defaulted and Closed are stored (`ended`, an enum `None | Defaulted | Closed`) because they freeze the vault; once set, `state()` returns them. Repaid wins over Trapped as today; a Repaid vault can be neither Defaulted nor Closed.

## 3. Owner bond (K1, K2)

- The factory is created with the fUSD address (immutable) and a bond of **10 % of the loan target** (`BOND_BPS = 1000`, constant). `VaultFactory.create(init)` no longer takes a token; it passes its own.
- `create` pulls the bond from `msg.sender` with `transferFrom` into the new vault and records it in the vault's `bondHeld`. The caller must have approved the factory.
- The bond is part of the books: `balance == escrowTotal + lenderPool + ownerPending + opexBalance + raisedHeld + bondHeld`.
- Refunded: the owner (`ownerPq`) calls `withdrawBond()` and it goes to `ownerPayout`.
- Repaid: `withdrawRemainder()` pays `opexBalance + bondHeld` to `ownerPayout`.
- Defaulted or Closed: the bond moves to the lender pool (section 6).

## 4. Suppliers (K1)

- The initial list stays as v1 (role addresses refused). Adding a supplier is already a widening order, locked until Repaid, so the list cannot grow during a loan.
- `paySupplier(supplier, amount, orderId)` now requires `orderId` to be an order in status Open, records `supplierCost[orderId] += amount`, and refuses when `supplierCost[orderId] > price of that order` (`OverOrderPrice`). A sale can no longer cost more than it brought in, so draining principal needs real buyer money: to move `D` of principal to a fake supplier the owner must pay `2D` in fake sales at a 50 % opex share, of which lenders receive their share.
- Not paused and not ended, plus the v1 caps.
- Off-chain, the Market marks a business **Unverified suppliers** when any listed supplier is not in Qredit's supplier list (`packages/qore/src/suppliers.json`).

## 5. Buyer review (K4)

New order states: `Open → InReview → Settled | Rejected`, plus v1 `Declined` and `Reclaimed`.

| Function | Caller | Rule |
|---|---|---|
| `deliver(id, envelopeHash)` | `operator` | Open and before the order deadline. Sets `InReview`, `reviewEnds = now + REVIEW_WINDOW` (24 h, constant). Escrow is kept. Emits `Delivered(id, envelopeHash, reviewEnds)`. |
| `accept(id)` | Buyer | InReview. Settles at once. |
| `settle(id)` | Anyone | InReview and `now > reviewEnds`. Settles. |
| `reject(id)` | Buyer | InReview and `now ≤ reviewEnds`. `cost = min(supplierCost[id], price)`; the buyer gets `price − cost`, the vault keeps `cost` in `opexBalance`. Emits `Rejected(id, refund, cost)`. |

Settling releases escrow through the split and emits `Settled(id, toLenders, toOwner, toOpex)`. `decline` and `reclaim` keep their v1 rules but `decline` also refunds `price − cost` with the cost kept in opex (the agent spent it before declining), and `reclaim` refunds the full price (the agent failed to deliver in time). The order deadline (`orderTtl`) only bounds delivery; review runs after it.

The Market shows each business's rejection rate (`Rejected` over delivered orders), read from events by the backend.

## 6. Owner share, default and close (K2, K3)

**Owner claim.** `claimOwner()` pays `ownerPending` only when the state is Active and `repaid ≥ expectedRepaid(now + period)`, i.e. one installment ahead of schedule; otherwise `OwnerClaimNotAhead`. Repaid: allowed as v1.

**Loan terms** gain three fields: `maturity` (seconds after activation), `maturityGrace` (seconds), `defaultAfterMissed` (installments, 3 in all vaults we create). Constructor checks: `maturity > 0`, `defaultAfterMissed > 0`, `installment × (maturity / period) ≥ totalOwed` (the schedule can reach the debt by maturity).

**`triggerDefault()`**, anyone, when not ended and not Repaid and either:
- `expectedRepaid(now) − repaid ≥ defaultAfterMissed × installment`, or
- `now > activatedAt + maturity + maturityGrace`.

**Close** is a new policy kind (`Close`, narrowing, allowed in any non-ended, non-Raising state except Repaid), signed like every order.

**Ending** (both paths, `_end(kind)`):
1. `ended = kind`; emit `Ended(kind)`.
2. `sweep = opexBalance + ownerPending + bondHeld`; set the three to zero.
3. The sweep goes to lenders through the same accumulator as repayments (`lenderPool += sweep`, `accPerShare += sweep × ACC / raised`), but **not** counted in `repaid`. Lenders claim it with `claimLender()`.
4. After ending: `buy`, `paySupplier`, `deposit`, policy orders and `claimOwner` revert with `Ended`. `deliver` (before deadline), `accept`, `settle`, `reject`, `decline` and `reclaim` still work for orders already placed; a settlement after ending sends the whole price to lenders (owner and opex parts zero), and a rejection's kept cost goes to lenders too.

## 7. Agent keys (K5)

- `spender` and `operator` become mutable storage.
- New policy kind `RotateAgent` (neutral, allowed during the loan): `target` is the new spender, `value` holds the new operator as `uint256(uint160(addr))`. Both must be non-zero and not a supplier, `ownerPq`, `ownerPayout` or the vault. Emits `AgentRotated(spender, operator)`.
- `selfPause()`: `spender` or `operator` may pause the vault (not unpause). Emits `Paused(by)`. Unpause stays an owner order.

## 8. Buyers (K7)

- `buy` refuses `msg.sender` equal to `ownerPq`, `ownerPayout`, `spender`, `operator`, or an allowed supplier (`BuyerNotAllowed`).
- `uniqueBuyers` counts first-time buyers (`seenBuyer[address]`). The business page shows it next to the order count.
- The threat model states the limit: an owner with other addresses can still buy from itself.

## 9. Errors and events

New errors: `Ended`, `OverOrderPrice`, `NotInReview`, `ReviewOpen`, `ReviewOver`, `OwnerClaimNotAhead`, `NotDefaultable`, `BuyerNotAllowed`, `NotAgent`.
New events: `Settled`, `Rejected`, `Ended`, `AgentRotated`, `Paused(by)`, `BondReturned`. `Delivered` gains `reviewEnds` and loses the split fields (they move to `Settled`).

## 10. Migration (v1 stays, hidden)

- Deploy the v2 factory and four new vaults with the same businesses, services and suppliers. Demo terms stay short (hours) so Trapped, Repaid and Defaulted can be shown.
- v1 vaults stay on chain untouched. The backend marks them `version: 1` and the Market, lend and buy flows list only v2. Inbox, report and lend positions still read v1 so old orders open and v1 lenders can refund or claim.
- The engine points every agent at its v2 vault and, after delivering, runs `settle` for its own orders once their review ends.

## 11. App changes this forces

- **`packages/qore`**: new ABI, the v2 factory address, order statuses, and `state()` values.
- **Engine**: `deliver` no longer settles; a settle loop for due reviews; `paySupplier` with the order id it already passes; read the order from the vault before sealing (also closes off-chain finding L3).
- **Backend watcher**: `Delivered`, `Settled`, `Rejected`, `Ended`, `AgentRotated`; order statuses `in_review`, `settled`, `rejected`; rejection rate and unique buyers per business.
- **Web app**:
  - Inbox and report: an In review badge with the time left, **Accept** and **Reject** (Reject confirmed with `ConfirmDialog`, showing the refund `price − cost`).
  - Lend: Defaulted and Closed badges; positions show what the sweep added to Claim.
  - Owner console: `Close` (confirmed, irreversible) and `RotateAgent`; the owner claim explains "one installment ahead".
  - Market and business page: bond held, maturity date, Unverified suppliers label, unique buyers, rejection rate.
  - A **Default this loan** button on the business page when `triggerDefault` would pass (dry run first, like policy orders).
- **Proof page and attack list**: new refused attacks — supplier payment over the order price, buy from the owner's address, owner claim while behind, widening Close/Rotate attempts by a non-owner, settling before the review ends.

## 12. Testing

- Foundry unit tests per rule above, one file per area as today (`Raising`, `Orders`, `Review`, `Suppliers`, `Policy`, `Claims`, `Default`).
- The invariant test gains `bondHeld` in the books and a handler for accept, reject, settle, triggerDefault and Close; invariants: books balance, `repaid ≤ totalOwed`, lenders' total claimable never exceeds `lenderPool`.
- A fuzz test: for any sequence of sales and supplier payments, opex spent on an order never exceeds its price.
- Engine, backend and web tests updated for the new statuses; a testnet smoke run (deploy, raise, buy, deliver, accept, settle, reject, trigger default) recorded with transaction hashes before the app switches to v2.

## 13. Out of scope

A curated on-chain supplier registry, third-party arbitration of rejections, owner stake slashing beyond the bond, and per-buyer rejection limits. They go to the roadmap in the README.
