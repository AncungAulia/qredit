# Qredit Plan 4: Vault v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-11-26-qredit-vault-v2-design.md`: a `LoanVault` v2 and `VaultFactory` v2 that close holes K1 to K7 (owner bond, per-order supplier cost, buyer review, owner claim only when ahead, default and close, agent key rotation, fixed token, buyer restrictions), deploy them on the testnet next to v1, and move the backend, the engine and the web app to v2 while v1 stays readable.

**Architecture:** The contract changes land first, in small test-driven steps, each keeping `forge test` green. The v1 ABI is frozen in `packages/qore` before the v2 ABI is generated, so every app can read both versions; the backend keys businesses by vault and stores a `version`, the watcher decodes each vault with the events of its version, and the web app lists only v2 in Market, lending and buying while Inbox and positions read both. The engine points every agent at its v2 vault, reads each order from the vault before it seals, and settles its own orders once their review ends. Nothing is broadcast to the testnet without the human's go-ahead.

**Tech Stack:** Foundry (solc 0.8.28, `via_ir`, OpenZeppelin `SafeERC20`), Bun workspaces (`packages/qore`, `engine`, `apps/be` with Hono and PGlite tests), viem 2, Next.js 16 + React 19 + TanStack Query + react-hook-form + zod + shadcn on Base UI in `apps/fe` (Vitest), `@qorechain/sdk` 0.14.0 (pinned, not upgraded).

## Global Constraints

- Network: testnet only, chain id `qorechain-diana`, EVM chain id 9800. PQC precompiles `pqcVerify` `0x0000000000000000000000000000000000000a01`, `pqcKeyStatus` `0x0000000000000000000000000000000000000a02`.
- Token: fUSD `0x97143B771D34ddb9130b807b135Ae675A5a963CA`, 6 decimals. The v2 `VaultFactory` takes it in its constructor (immutable `token`); `create(init)` takes no token.
- Owner bond: `BOND_BPS = 1000` (constant, 10 % of the loan target), `bond = target * BOND_BPS / 10_000`, pulled by `VaultFactory.create` from `msg.sender` with `transferFrom` into the new vault and held in `bondHeld`.
- Books: `balance == escrowTotal + lenderPool + ownerPending + opexBalance + raisedHeld + bondHeld`; `books()` returns `(escrow, lenders, ownerOwed, opex, held, bond)` in this order.
- Buyer review: `REVIEW_WINDOW = 24 hours` (86 400 seconds, constant). `deliver` sets `reviewEnds = now + REVIEW_WINDOW`; `accept` (buyer), `settle` (anyone, `now > reviewEnds`), `reject` (buyer, `now <= reviewEnds`, refund `price - min(supplierCost, price)`).
- Loan terms gain `maturity` (seconds after activation), `maturityGrace` (seconds), `defaultAfterMissed` (installments), appended after `installment`; `defaultAfterMissed = 3` in every vault Qredit creates. Constructor: `maturity > 0`, `defaultAfterMissed > 0`, `installment * (maturity / period) >= totalOwed`.
- `State`: `Raising 0, Active 1, Trapped 2, Repaid 3, Refunded 4, Defaulted 5, Closed 6`. `EndKind` (`ended`): `None 0, Defaulted 1, Closed 2`.
- `OrderStatus`: `None 0, Open 1, InReview 2, Settled 3, Rejected 4, Declined 5, Reclaimed 6`. `orders(id)` returns `(buyer, serviceId, deadline, status, price, requestRef, reviewEnds)`.
- Policy kinds (index = `kind`): `RemoveSupplier 0, LowerSupplierCap 1, LowerDailyCap 2, Pause 3, Unpause 4, AddSupplier 5, RaiseSupplierCap 6, RaiseDailyCap 7` (widening: 5, 6, 7), `Close 8` (narrowing), `RotateAgent 9` (neutral; `target` = new spender, `value` = `uint256(uint160(newOperator))`). `POLICY_TAG` stays `keccak256("qredit-policy-v1")`.
- New errors (exact names): `Ended`, `OverOrderPrice`, `NotInReview`, `ReviewOpen`, `ReviewOver`, `OwnerClaimNotAhead`, `NotDefaultable`, `BuyerNotAllowed`, `NotAgent`. `TrappedNoOwnerClaim` is removed (a Trapped vault refuses with `OwnerClaimNotAhead`).
- New events (exact signatures): `Settled(uint256 indexed orderId, uint256 toLenders, uint256 toOwner, uint256 toOpex)`, `Rejected(uint256 indexed orderId, uint256 refund, uint256 cost)`, `LoanEnded(uint8 kind)`, `AgentRotated(address spender, address operator)`, `AgentPaused(address indexed by)`, `BondReturned(uint256 amount)`; `Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 reviewEnds)`. (`LoanEnded` and `AgentPaused` are the spec's `Ended` and `Paused(by)`, renamed because Solidity refuses an event and an error with one name; see Decisions.)
- Backend order statuses: `open`, `claimed`, `delivered` (v1 vaults only), `in_review`, `settled`, `rejected`, `declined`, `reclaimed`. Backend businesses carry `version` (`1` or `2`) and `ended` (`null`, `defaulted`, `closed`).
- v1 stays on chain untouched: factory `0xAc5324088A7735dda922c277db5A2E906c8f5b3A`, start block 10 667 776. The v2 factory address and start block are recorded in Task 7 and used from Task 8 on.
- **Broadcast rule:** any step that deploys a contract or spends testnet funds (QOR or fUSD) starts with **STOP: ask the human and wait for a yes**. Read-only chain calls (`eth_call`, `getCode`, `getLogs`, balances) need no approval.
- Rules of the repo-root `CLAUDE.md` and of `apps/be`, `apps/fe`, `engine` `CLAUDE.md` bind every task: evidence over claims ("not proven yet" when no test output, hash or log was seen), SOLID/DRY/ACID (multi-step backend writes in one transaction, idempotent event handlers), secrets only in gitignored paths, everything in English, no mention of how long anything takes or of a schedule.
- Commands: `forge test` in `sc/`; `bun test` and `bun run typecheck` in `packages/qore`, `engine`, `apps/be`; `bun run test`, `bun run typecheck` and `bun run lint` in `apps/fe`.
- Commits: one per task, conventional prefix with scope (`feat(sc): …`, `feat(qore): …`, `feat(be): …`, `feat(engine): …`, `feat(fe): …`, `docs: …`); the body says why and which tests ran; it ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `sc/src/LoanVault.sol` | Modify | v2 vault: bond, terms with maturity, per-order supplier cost, buyer review, owner claim rule, default and close, agent rotation, self pause, buyer restrictions |
| `sc/src/VaultFactory.sol` | Modify | v2 factory: fixed token, pulls the bond into each vault |
| `sc/script/DeployFactory.s.sol` | Modify | Deploys the v2 factory with the fUSD address |
| `sc/script/CreateSmokeVault.s.sol` | Modify | Kept compiling against the v2 `Init` (approves the bond) |
| `sc/test/Base.t.sol` | Modify | Vaults created through a factory, v2 terms, `_booksSum`, `_accept`, `_settleNow` |
| `sc/test/LoanVault.{Raising,Orders,Suppliers,Policy,Claims,Fuzz,Invariant}.t.sol`, `sc/test/VaultFactory.t.sol` | Modify | Existing rules under v2, plus the new rules of their area |
| `sc/test/LoanVault.Review.t.sol` | Create | `deliver`, `accept`, `settle`, `reject`, `decline` with cost |
| `sc/test/LoanVault.Default.t.sol` | Create | `triggerDefault`, `Close`, ending sweep, what still works after ending |
| `sc/README.md` | Modify | v2 contracts, deploy record, v1 kept |
| `packages/qore/src/generated/abis-v1.ts` | Create | Frozen v1 vault ABI (`LOAN_VAULT_V1_ABI`) |
| `packages/qore/src/generated/abis.ts` | Regenerate | v2 ABIs and factory code hash |
| `packages/qore/scripts/export-abi.ts`, `packages/qore/scripts/immutables.ts` | Modify / Create | Generation; fills the factory's immutable `token` before hashing |
| `packages/qore/src/abi.ts` | Modify | v2 factory address and start block, v1 constants, v2 and v1 event sets, `VAULT_STATE`, `ORDER_STATUS`, `BOND_BPS`, `REVIEW_WINDOW_SECONDS`, `bondFor` |
| `packages/qore/package.json` | Modify | `./abis-v1` export |
| `engine/businesses.json`, `engine/src/setup/businesses.ts` | Modify | Maturity terms per business; `vaultInit` without token |
| `engine/src/setup/chain.ts` | Modify | Bond approval before create, agent re-link for the v2 vault |
| `engine/deployments.v1.json` | Create (git mv) | v1 deployments kept for the record |
| `engine/src/setup/smoke.ts`, `engine/scripts/smoke-v2.ts` | Create | Testnet smoke run of v2 (phases a and b) |
| `engine/src/cli/owner.ts` | Modify | `business create` registers `version: 2`, re-links the agent |
| `engine/src/agent/{chain,pipeline,run,types,api}.ts`, `engine/src/agent/settle.ts` | Modify / Create | Order read from the vault, operator `settle`, settle loop |
| `engine/RESULTS.md` | Modify | v2 smoke run record |
| `apps/be/migrations/003_vault_v2.sql` | Create | `version`, `ended`, businesses keyed by vault, new order statuses, `review_ends`, `refund` |
| `apps/be/src/db/store/{businesses,orders}.ts` | Modify | v2 rows, events, stats |
| `apps/be/src/services/watcher.ts`, `apps/be/src/server.ts` | Modify | Events per version, vault-level events |
| `apps/be/src/http/routes/{businesses,orders}.ts` | Modify | `version`, stats, new statuses |
| `apps/fe/src/lib/{schemas,vaultState,chain}.ts` | Modify | v2 schemas, states, v1 reads |
| `apps/fe/src/components/shared/{StateBadge,OrderStatusBadge}.tsx`, `vaultErrors.ts` | Modify | New states, statuses and errors |
| `apps/fe/src/modules/market/**` | Modify | v2 only, bond, maturity, unique buyers, rejection rate, Unverified suppliers |
| `apps/fe/src/modules/inbox/**` | Modify | In review with time left, Accept, Reject, v1 orders readable |
| `apps/fe/src/modules/lend/**` | Modify | Defaulted and Closed, sweep in positions, v1 positions |
| `apps/fe/src/modules/owner/**` | Modify | `Close`, `RotateAgent`, owner claim rule |
| `apps/fe/src/modules/business/**` | Modify | v2 labels, Default this loan with dry run |
| `apps/fe/src/modules/orders/**` | Modify | Buying only from v2 vaults |
| `apps/fe/src/config/attacks.ts`, `apps/fe/src/modules/proof/**` | Modify | New refused attacks, books with bond |
| `README.md`, `sc/README.md`, `apps/be/CLAUDE.md`, `apps/fe/CLAUDE.md`, `engine/CLAUDE.md`, `docs/superpowers/specs/2026-11-24-qredit-design.md`, `docs/threat-model.md` | Modify / Create | Docs |

---

## Design references

Web tasks (14–19) build from these frames in `design/qredit.pen` (light id / dark id). Read them with the Pencil MCP before coding a screen; the design wins over the plan's markup where they differ.

| Screen | Row | Light | Dark |
|---|---|---|---|
| Report | In review (sticky review bar, Accept / Reject) | `L3L5qz` | `M2q8Y` |
| Report | Reject confirm (dialog, phone sheet, refund lines) | `VAC84` | `ocS9j` |
| Inbox | Normal (In review, Accepted, Rejected badges) | `UnR9h` | `Z33kLx` |
| Business page | Normal (Owner bond, Maturity, Default, Buyers terms) | `W45icI` | `FJgfK` |
| Business page | Default available (warning notice + Default this loan) | `o4EgaF` | `cpwWU` |
| Business page | Default confirm (dry run passed, what moves to lenders) | `N5c8Y` | `ZoJvw` |
| Business page | Defaulted (danger notice, Buy disabled) | `RUsYm` | `SvRFj` |
| Market | Ended and unverified (Defaulted card with View; Unverified suppliers label) | `LfPpI` | `S6D8qz` |
| My lending | Normal (Defaulted position, sweep in Claimable; Status column right after Business) | `cvg3c` | `I7Ze2` |
| Owner console | Write an order (Rotate the agent keys, Close the business, Your share, Your bond) | `ZineO` | `AXMaL` |

Copy decided in the design: the review bar reads "Review this report · 23 h 14 min left"; Reject confirm buttons are "Keep the report" and "Reject and refund"; the inbox badges are "In review, 23 h left", "Accepted", "Rejected, 0.40 fUSD refunded" (a settled v2 order shows Accepted); a rejected report stays openable ("View report"). The positions table order is Business, Status, Lent, Repaid to you, Claimable, Action.


### Task 1: Contract: owner bond, fixed-token factory, maturity terms, ended states

**Files:**
- Modify: `sc/src/LoanVault.sol`, `sc/src/VaultFactory.sol`, `sc/script/DeployFactory.s.sol`, `sc/script/CreateSmokeVault.s.sol`
- Modify: `sc/test/Base.t.sol`, `sc/test/VaultFactory.t.sol`, `sc/test/LoanVault.Raising.t.sol`, `sc/test/LoanVault.Claims.t.sol`, `sc/test/LoanVault.Orders.t.sol`, `sc/test/LoanVault.Suppliers.t.sol`, `sc/test/LoanVault.Policy.t.sol`, `sc/test/LoanVault.Fuzz.t.sol`, `sc/test/LoanVault.Invariant.t.sol`

**Interfaces:**
- Consumes: v1 `LoanVault`, `VaultFactory`, `IQorePQC`, `MockToken`, `MockPqc`.
- Produces:
  - `constructor(IERC20 token_, LoanVault.Init memory init)`; `Init` without `token`.
  - `struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; uint64 maturity; uint64 maturityGrace; uint16 defaultAfterMissed; }`
  - `uint256 public constant BOND_BPS = 1000;` `uint256 public bondHeld;` `EndKind public ended;`
  - `enum State { Raising, Active, Trapped, Repaid, Refunded, Defaulted, Closed }`, `enum EndKind { None, Defaulted, Closed }`
  - `function books() external view returns (uint256 escrow, uint256 lenders, uint256 ownerOwed, uint256 opex, uint256 held, uint256 bond)`
  - `function withdrawBond() external` (ownerPq, Refunded), `event BondReturned(uint256 amount)`
  - `withdrawRemainder()` pays `opexBalance + bondHeld` when Repaid.
  - `VaultFactory(IERC20 token_)`, `IERC20 public immutable token`, `error BadToken()`, `create(LoanVault.Init calldata init) returns (LoanVault)` pulls `v.bondHeld()` from `msg.sender`.
  - Test helpers in `Base`: `factory`, `creator`, `BOND`, `MATURITY`, `MATURITY_GRACE`, `MISSED`, `_create(LoanVault.Init memory) returns (LoanVault)`, `_booksSum() returns (uint256)`.

- [ ] **Step 1: Write the failing tests**

Replace `sc/test/Base.t.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockPqcKeys, MockPqcVerify} from "./mocks/MockPqc.sol";
import {MockToken} from "./mocks/MockToken.sol";

abstract contract Base is Test {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEYS = 0x0000000000000000000000000000000000000a02;

    uint256 internal constant TARGET = 100e18;
    uint256 internal constant OWED = 110e18;
    uint256 internal constant INSTALLMENT = 10e18;
    uint64 internal constant PERIOD = 1 days;
    uint64 internal constant GRACE = 1 days;
    // 12 installments of 10 fUSD reach the 110 fUSD owed, so the schedule check passes.
    uint64 internal constant MATURITY = 12 days;
    uint64 internal constant MATURITY_GRACE = 1 days;
    uint16 internal constant MISSED = 3;
    // BOND_BPS = 1000: 10 % of the target.
    uint256 internal constant BOND = TARGET / 10;
    uint64 internal constant TTL = 1 hours;
    uint256 internal constant DAILY = 20e18;
    uint256 internal constant CAP_A = 10e18;
    uint256 internal constant CAP_B = 2e18;
    uint16 internal constant LENDER_BPS = 3000;
    uint16 internal constant OWNER_BPS = 2000;
    // service 0: 1 fUSD, service 1: 5 fUSD, service 2: 100 fUSD
    uint256 internal constant PRICE0 = 1e18;
    uint256 internal constant PRICE1 = 5e18;
    uint256 internal constant PRICE2 = 100e18;

    MockToken internal fusd;
    VaultFactory internal factory;
    LoanVault internal vault;
    uint64 internal raiseDeadline;

    address internal spender = makeAddr("spender");
    address internal operator = makeAddr("operator");
    address internal ownerPq = makeAddr("ownerPq");
    address internal ownerPayout = makeAddr("ownerPayout");
    address internal creator = makeAddr("creator");
    address internal lenderA = makeAddr("lenderA");
    address internal lenderB = makeAddr("lenderB");
    address internal buyer = makeAddr("buyer");
    address internal supplierA = makeAddr("supplierA");
    address internal supplierB = makeAddr("supplierB");
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        vm.etch(PQC_VERIFY, address(new MockPqcVerify()).code);
        vm.etch(PQC_KEYS, address(new MockPqcKeys()).code);
        fusd = new MockToken();
        factory = new VaultFactory(IERC20(address(fusd)));
        fusd.mint(creator, 10_000e18);
        vm.prank(creator);
        fusd.approve(address(factory), type(uint256).max);
        raiseDeadline = uint64(block.timestamp + 7 days);
        vault = _create(_init());
        address[3] memory funded = [lenderA, lenderB, buyer];
        for (uint256 i; i < funded.length; i++) {
            fusd.mint(funded[i], 10_000e18);
            vm.prank(funded[i]);
            fusd.approve(address(vault), type(uint256).max);
        }
    }

    function _init() internal view returns (LoanVault.Init memory i) {
        address[] memory sup = new address[](2);
        sup[0] = supplierA;
        sup[1] = supplierB;
        uint256[] memory caps = new uint256[](2);
        caps[0] = CAP_A;
        caps[1] = CAP_B;
        uint256[] memory prices = new uint256[](3);
        prices[0] = PRICE0;
        prices[1] = PRICE1;
        prices[2] = PRICE2;
        i = LoanVault.Init({
            spender: spender,
            operator: operator,
            ownerPq: ownerPq,
            ownerPayout: ownerPayout,
            cosmosChainId: "qorechain-diana",
            lenderBps: LENDER_BPS,
            ownerBps: OWNER_BPS,
            dailyCap: DAILY,
            orderTtl: TTL,
            loan: LoanVault.LoanTerms({
                target: TARGET,
                totalOwed: OWED,
                raiseDeadline: raiseDeadline,
                period: PERIOD,
                grace: GRACE,
                installment: INSTALLMENT,
                maturity: MATURITY,
                maturityGrace: MATURITY_GRACE,
                defaultAfterMissed: MISSED
            }),
            suppliers: sup,
            supplierCaps: caps,
            servicePrices: prices
        });
    }

    /// Creates a vault through the factory; `creator` pays the bond.
    function _create(LoanVault.Init memory i) internal returns (LoanVault v) {
        vm.prank(creator);
        v = factory.create(i);
    }

    function _booksSum() internal view returns (uint256) {
        (uint256 e, uint256 l, uint256 o, uint256 x, uint256 h, uint256 b) = vault.books();
        return e + l + o + x + h + b;
    }

    function _activate() internal {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.prank(lenderB);
        vault.deposit(40e18);
    }

    function _buy(uint256 serviceId) internal returns (uint256 id) {
        vm.prank(buyer);
        id = vault.buy(serviceId, keccak256(abi.encode("request", serviceId, block.timestamp)));
    }

    function _deliver(uint256 id) internal {
        vm.prank(operator);
        vault.deliver(id, keccak256(abi.encode("envelope", id)));
    }

    function _sell(uint256 serviceId, uint256 n) internal {
        for (uint256 k; k < n; k++) {
            _deliver(_buy(serviceId));
        }
    }

    function _order(uint8 kind, address target, uint256 value) internal view returns (LoanVault.PolicyOrder memory) {
        return LoanVault.PolicyOrder({
            kind: kind,
            target: target,
            value: value,
            nonce: vault.policyNonce(),
            expiry: uint64(block.timestamp + 1 hours)
        });
    }

    function _sign(LoanVault.PolicyOrder memory o) internal view returns (bytes memory) {
        return abi.encodePacked(keccak256(abi.encodePacked("ok", hex"c0ffee", vault.signedBytes(o))));
    }

    /// Replaces `vault` with a fresh one using custom service prices and funds it with two lenders' deposits.
    function _fresh(uint256[] memory prices, uint256 amountA, uint256 amountB) internal {
        LoanVault.Init memory i = _init();
        i.servicePrices = prices;
        _freshWith(i, amountA, amountB);
    }

    function _freshWith(LoanVault.Init memory i, uint256 amountA, uint256 amountB) internal {
        vault = _create(i);
        address[3] memory funded = [lenderA, lenderB, buyer];
        for (uint256 k; k < funded.length; k++) {
            vm.prank(funded[k]);
            fusd.approve(address(vault), type(uint256).max);
        }
        vm.prank(lenderA);
        vault.deposit(amountA);
        vm.prank(lenderB);
        vault.deposit(amountB);
    }
}
```

Replace `sc/test/VaultFactory.t.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

contract VaultFactoryTest is Base {
    function test_createsAndListsVaults() public {
        uint256 before = factory.count(); // Base.setUp created one vault
        vm.recordLogs();
        LoanVault a = _create(_init());
        LoanVault b = _create(_init());
        assertEq(factory.count(), before + 2);
        assertEq(address(factory.vaultAt(before)), address(a));
        assertEq(address(factory.all()[before + 1]), address(b));
        assertEq(a.operator(), operator);
        assertEq(a.ownerPq(), ownerPq);
        assertEq(address(a.token()), address(fusd));
        assertEq(uint8(a.state()), uint8(LoanVault.State.Raising));
        // Each create logs the bond Transfer and VaultCreated.
        assertEq(vm.getRecordedLogs().length, 4);
    }

    function test_createPullsTheBondFromTheCaller() public {
        uint256 before = fusd.balanceOf(creator);
        LoanVault v = _create(_init());
        assertEq(fusd.balanceOf(creator), before - BOND);
        assertEq(fusd.balanceOf(address(v)), BOND);
        assertEq(v.bondHeld(), BOND);
    }

    function test_createWithoutAllowanceReverts() public {
        fusd.mint(stranger, BOND);
        vm.prank(stranger);
        vm.expectRevert(); // the token refuses: no allowance for the factory
        factory.create(_init());
    }

    function test_tokenIsFixedAtDeployment() public view {
        assertEq(address(factory.token()), address(fusd));
    }

    function test_zeroTokenRefused() public {
        vm.expectRevert(VaultFactory.BadToken.selector);
        new VaultFactory(IERC20(address(0)));
    }

    function test_badConfigBubblesUp() public {
        LoanVault.Init memory i = _init();
        i.spender = address(0);
        vm.prank(creator);
        vm.expectRevert(LoanVault.BadConfig.selector);
        factory.create(i);
    }
}
```

Append to `sc/test/LoanVault.Raising.t.sol` (inside the contract; add `import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";` at the top):

```solidity
    function test_bondHeldAtCreation() public view {
        assertEq(vault.bondHeld(), BOND);
        assertEq(BOND, TARGET * vault.BOND_BPS() / 10_000);
        assertEq(fusd.balanceOf(address(vault)), BOND);
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function test_constructorRejectsZeroMaturity() public {
        LoanVault.Init memory i = _init();
        i.loan.maturity = 0;
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(IERC20(address(fusd)), i);
    }

    function test_constructorRejectsZeroDefaultAfterMissed() public {
        LoanVault.Init memory i = _init();
        i.loan.defaultAfterMissed = 0;
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(IERC20(address(fusd)), i);
    }

    function test_constructorRejectsScheduleShortOfDebt() public {
        LoanVault.Init memory i = _init();
        i.loan.maturity = 10 days; // 10 installments of 10 fUSD stay below the 110 fUSD owed
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(IERC20(address(fusd)), i);
    }

    function test_constructorAcceptsScheduleThatReachesDebt() public {
        LoanVault.Init memory i = _init();
        i.loan.maturity = 11 days; // 11 x 10 = 110
        LoanVault v = new LoanVault(IERC20(address(fusd)), i);
        (,,,,,, uint64 maturity, uint64 maturityGrace, uint16 missed) = v.loan();
        assertEq(maturity, 11 days);
        assertEq(maturityGrace, MATURITY_GRACE);
        assertEq(missed, MISSED);
    }

    function test_constructorRejectsTargetTooSmallForABond() public {
        LoanVault.Init memory i = _init();
        i.loan.target = 9;
        i.loan.totalOwed = 9;
        i.loan.installment = 9; // bond = 9 * 1000 / 10000 = 0
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(IERC20(address(fusd)), i);
    }

    function test_constructorRejectsZeroToken() public {
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(IERC20(address(0)), _init());
    }

    function test_withdrawBondAfterFailedRaise() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.warp(raiseDeadline + 1);
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotOwner.selector);
        vault.withdrawBond();
        vm.expectEmit(address(vault));
        emit LoanVault.BondReturned(BOND);
        vm.prank(ownerPq);
        vault.withdrawBond();
        assertEq(fusd.balanceOf(ownerPayout), BOND);
        assertEq(vault.bondHeld(), 0);
        vm.prank(ownerPq);
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.withdrawBond();
        vm.prank(lenderA);
        vault.refund();
        assertEq(fusd.balanceOf(address(vault)), 0);
    }

    function test_withdrawBondRefusedWhileRaisingOrActive() public {
        vm.prank(ownerPq);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.withdrawBond();
        _activate();
        vm.prank(ownerPq);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.withdrawBond();
    }
```

Edit the existing tests for the v2 constructor, the factory and the sixth book (exact replacements):
- `LoanVault.Raising.t.sol`: every `new LoanVault(i)` becomes `new LoanVault(IERC20(address(fusd)), i)`; in `test_booksMatchBalanceWhileRaising` replace the two lines from `(uint256 e, ...` with `assertEq(_booksSum(), fusd.balanceOf(address(vault)));`; in `test_refundTwoLendersAfterPartialRaise` replace `assertEq(fusd.balanceOf(address(vault)), 0);` with `assertEq(fusd.balanceOf(address(vault)), BOND, "only the bond is left");`.
- `LoanVault.Orders.t.sol`: in `test_buyBeforeActivationReverts` replace `new LoanVault(_init())` with `_create(_init())`; in `test_booksMatchBalanceAfterOrders` replace the books lines with `assertEq(_booksSum(), fusd.balanceOf(address(vault)));`.
- `LoanVault.Suppliers.t.sol`: in `test_noPaymentsBeforeActivation` replace `new LoanVault(_init())` with `_create(_init())`.
- `LoanVault.Policy.t.sol`: in `test_fixedSigningVector` replace `abi.encode(_init())` with `abi.encode(IERC20(address(fusd)), _init())` and add the `IERC20` import; in `test_signatureForOtherVaultRefused` replace `new LoanVault(_init())` with `_create(_init())`; in `test_signatureForOtherCosmosChainRefused` replace `new LoanVault(i)` with `_create(i)`. `PINNED_DIGEST` stays: the digest binds the tag, chain id, vault address and order fields, none of which changed.
- `LoanVault.Claims.t.sol`: in `test_sumOfLenderClaimsNeverExceedsPool`, `test_oddDepositsAndPricesRoundDownSafely` and `test_oddDepositsAndPricesAtSixDecimalScale` replace the books lines with `assertEq(_booksSum(), fusd.balanceOf(address(vault)));`; in `test_withdrawRemainderOnlyByOwnerWhenRepaid` replace `assertEq(fusd.balanceOf(ownerPayout), opex);` with `assertEq(fusd.balanceOf(ownerPayout), opex + BOND, "opex and bond go back");` and add after it `assertEq(vault.bondHeld(), 0);`.
- `LoanVault.Fuzz.t.sol`: in `testFuzz_splitConservesPrice` replace the books lines with `assertEq(_booksSum(), fusd.balanceOf(address(vault)));`.
- `LoanVault.Invariant.t.sol`: replace `invariant_booksEqualBalance` with:

```solidity
    function invariant_booksEqualBalance() public view {
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }
```

- [ ] **Step 2: Run the tests and see them fail**

Run (in `sc/`): `forge test`
Expected: compilation fails, for example `Error (9582): Member "bondHeld" not found` and `Wrong argument count for function call` on `new VaultFactory(...)`.

- [ ] **Step 3: Implement**

Replace `sc/src/VaultFactory.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LoanVault} from "./LoanVault.sol";

/// @title VaultFactory (v2)
/// @notice Deploys LoanVaults in one fixed token and lists them for the Qredit market. Anyone may create a vault;
/// the creator pays the owner's bond (BOND_BPS of the target) into the new vault.
contract VaultFactory {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    LoanVault[] internal vaults;

    event VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index);

    error BadToken();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert BadToken();
        token = token_;
    }

    function create(LoanVault.Init calldata init) external returns (LoanVault v) {
        v = new LoanVault(token, init);
        token.safeTransferFrom(msg.sender, address(v), v.bondHeld());
        vaults.push(v);
        emit VaultCreated(address(v), init.ownerPq, init.spender, init.operator, vaults.length - 1);
    }

    function count() external view returns (uint256) {
        return vaults.length;
    }

    function vaultAt(uint256 index) external view returns (LoanVault) {
        return vaults[index];
    }

    function all() external view returns (LoanVault[] memory) {
        return vaults;
    }
}
```

In `sc/src/LoanVault.sol` make these changes (the rest of the file stays as v1):

```solidity
/// @title LoanVault (v2)
/// @notice Working capital for one AI agent business. Lenders fund it in fUSD; the owner's bond sits beside the
/// principal; the agent's spender may pay only listed suppliers under caps; buyers' payments sit in escrow until the
/// agent's operator delivers a sealed report and the buyer's review ends, then the contract splits them, lenders first.
/// Policy changes need the owner's ML-DSA-87 signature (checked by the pqcVerify precompile),
/// and while the loan runs only changes that narrow the rules are accepted.
contract LoanVault {
    using SafeERC20 for IERC20;

    IQorePQC internal constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC internal constant PQC_KEYS = IQorePQC(0x0000000000000000000000000000000000000a02);

    uint256 internal constant BPS = 10_000;
    // 1e36 keeps per-delivery truncation below 1 wei; toLenders * 1e36 and deposits * accPerShare stay far below 2^256.
    uint256 internal constant ACC = 1e36;
    bytes32 internal constant POLICY_TAG = keccak256("qredit-policy-v1");
    /// The owner's bond in basis points of the loan target; the factory pulls it from the creator.
    uint256 public constant BOND_BPS = 1000;

    enum State { Raising, Active, Trapped, Repaid, Refunded, Defaulted, Closed }
    enum EndKind { None, Defaulted, Closed }
    enum OrderStatus { None, Open, Delivered, Declined, Reclaimed }
    enum Kind { RemoveSupplier, LowerSupplierCap, LowerDailyCap, Pause, Unpause, AddSupplier, RaiseSupplierCap, RaiseDailyCap }

    struct LoanTerms {
        uint256 target;
        uint256 totalOwed;
        uint64 raiseDeadline;
        uint64 period;
        uint64 grace;
        uint256 installment;
        uint64 maturity;
        uint64 maturityGrace;
        uint16 defaultAfterMissed;
    }

    struct Init {
        address spender;
        address operator;
        address ownerPq;
        address ownerPayout;
        string cosmosChainId;
        uint16 lenderBps;
        uint16 ownerBps;
        uint256 dailyCap;
        uint64 orderTtl;
        LoanTerms loan;
        address[] suppliers;
        uint256[] supplierCaps;
        uint256[] servicePrices;
    }
```

Replace the books block, add the ending flag and the bond event:

```solidity
    // Books: balance == escrowTotal + lenderPool + ownerPending + opexBalance + raisedHeld + bondHeld
    uint256 public escrowTotal;
    uint256 public lenderPool;
    uint256 public ownerPending;
    uint256 public opexBalance;
    uint256 public raisedHeld;
    uint256 public bondHeld;

    /// Set once, by a default or a Close order; it freezes the vault (state() returns it).
    EndKind public ended;
```

```solidity
    event BondReturned(uint256 amount);
```

Replace the constructor:

```solidity
    constructor(IERC20 token_, Init memory init) {
        if (
            address(token_) == address(0) || init.spender == address(0) || init.operator == address(0)
                || init.ownerPq == address(0) || init.ownerPayout == address(0)
        ) revert BadConfig();
        if (uint256(init.lenderBps) + init.ownerBps > BPS) revert BadConfig();
        if (init.suppliers.length != init.supplierCaps.length || init.servicePrices.length == 0) revert BadConfig();
        LoanTerms memory l = init.loan;
        if (
            l.target == 0 || l.totalOwed < l.target || l.period == 0 || l.installment == 0
                || l.raiseDeadline <= block.timestamp || init.orderTtl == 0 || bytes(init.cosmosChainId).length == 0
        ) revert BadConfig();
        // The schedule must be able to reach the debt by maturity (checked after period != 0).
        if (l.maturity == 0 || l.defaultAfterMissed == 0 || l.installment * (l.maturity / l.period) < l.totalOwed) {
            revert BadConfig();
        }
        uint256 bond = l.target * BOND_BPS / BPS;
        if (bond == 0) revert BadConfig();

        token = token_;
        spender = init.spender;
        operator = init.operator;
        ownerPq = init.ownerPq;
        ownerPayout = init.ownerPayout;
        lenderBps = init.lenderBps;
        ownerBps = init.ownerBps;
        orderTtl = init.orderTtl;
        cosmosChainId = bytes(init.cosmosChainId);
        loan = l;
        dailyCap = init.dailyCap;
        bondHeld = bond;
        for (uint256 i; i < init.suppliers.length; i++) {
            address sup = init.suppliers[i];
            if (sup == address(0) || init.supplierCaps[i] == 0) revert BadConfig();
            if (_isRole(sup, init.spender, init.operator, init.ownerPq, init.ownerPayout)) revert BadConfig();
            suppliers[init.suppliers[i]] = Supplier(true, init.supplierCaps[i]);
        }
        for (uint256 i; i < init.servicePrices.length; i++) {
            if (init.servicePrices[i] == 0) revert BadConfig();
            servicePrices.push(init.servicePrices[i]);
        }
    }
```

Replace `state()` and `books()`:

```solidity
    function state() public view returns (State) {
        if (ended == EndKind.Defaulted) return State.Defaulted;
        if (ended == EndKind.Closed) return State.Closed;
        if (activatedAt == 0) return block.timestamp > loan.raiseDeadline ? State.Refunded : State.Raising;
        if (repaid >= loan.totalOwed) return State.Repaid;
        return repaid < expectedRepaid(block.timestamp) ? State.Trapped : State.Active;
    }
```

```solidity
    function books()
        external
        view
        returns (uint256 escrow, uint256 lenders, uint256 ownerOwed, uint256 opex, uint256 held, uint256 bond)
    {
        return (escrowTotal, lenderPool, ownerPending, opexBalance, raisedHeld, bondHeld);
    }
```

Replace `withdrawRemainder()` and add `withdrawBond()` in the owner section:

```solidity
    /// Repaid: the owner takes the operating funds and the bond back.
    function withdrawRemainder() external {
        if (msg.sender != ownerPq) revert NotOwner();
        if (state() != State.Repaid) revert WrongState();
        uint256 opex = opexBalance;
        uint256 bond = bondHeld;
        if (opex + bond == 0) revert ZeroAmount();
        opexBalance = 0;
        bondHeld = 0;
        token.safeTransfer(ownerPayout, opex + bond);
        if (opex > 0) emit RemainderWithdrawn(opex);
        if (bond > 0) emit BondReturned(bond);
    }

    /// Refunded: the raise failed, so the bond goes back to the owner.
    function withdrawBond() external {
        if (msg.sender != ownerPq) revert NotOwner();
        if (state() != State.Refunded) revert WrongState();
        uint256 amount = bondHeld;
        if (amount == 0) revert ZeroAmount();
        bondHeld = 0;
        token.safeTransfer(ownerPayout, amount);
        emit BondReturned(amount);
    }
```

Replace `sc/script/DeployFactory.s.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// Deploys the v2 factory in fUSD. Env: PRIVATE_KEY (deployer; needs an unscoped EVM window).
contract DeployFactory is Script {
    address internal constant FUSD = 0x97143B771D34ddb9130b807b135Ae675A5a963CA;

    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        VaultFactory f = new VaultFactory(IERC20(FUSD));
        vm.stopBroadcast();
        console.log("VaultFactory", address(f));
    }
}
```

In `sc/script/CreateSmokeVault.s.sol` remove the `token:` line from the `Init`, add the three terms to `LoanTerms` (`maturity: 11 days, maturityGrace: 1 days, defaultAfterMissed: 3` after `installment: 1e5`; 11 installments of 1e5 reach 11e5 owed), and replace the broadcast block with:

```solidity
        address factory = vm.envAddress("FACTORY");
        uint256 bond = init.loan.target * 1000 / 10_000; // LoanVault.BOND_BPS
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        IERC20(0x97143B771D34ddb9130b807b135Ae675A5a963CA).approve(factory, bond);
        LoanVault v = VaultFactory(factory).create(init);
        vm.stopBroadcast();
        console.log("SmokeVault", address(v));
```

- [ ] **Step 4: Run the tests and see them pass**

Run (in `sc/`): `forge test`
Expected: all suites pass, including `VaultFactoryTest` (6 tests) and the nine new `LoanVaultRaisingTest` tests; `forge build` prints no error for `script/`.

- [ ] **Step 5: Commit**

```bash
git add sc/src/LoanVault.sol sc/src/VaultFactory.sol sc/script/DeployFactory.s.sol sc/script/CreateSmokeVault.s.sol sc/test/Base.t.sol sc/test/VaultFactory.t.sol sc/test/LoanVault.Raising.t.sol sc/test/LoanVault.Claims.t.sol sc/test/LoanVault.Orders.t.sol sc/test/LoanVault.Suppliers.t.sol sc/test/LoanVault.Policy.t.sol sc/test/LoanVault.Fuzz.t.sol sc/test/LoanVault.Invariant.t.sol
git commit -m "feat(sc): owner bond, fixed-token factory and maturity terms" -m "Vault v2 (spec sections 2 and 3): the factory takes fUSD once and pulls a 10 % bond from the creator into each vault, the books count bondHeld, the bond returns on Refunded or Repaid, and loan terms carry maturity, maturityGrace and defaultAfterMissed with the schedule check. Defaulted and Closed exist as states for the later ending tasks. Tests: forge test (all suites)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Contract: per-order supplier cost and buyer restrictions

**Files:**
- Modify: `sc/src/LoanVault.sol`
- Modify: `sc/test/LoanVault.Suppliers.t.sol`, `sc/test/LoanVault.Orders.t.sol`, `sc/test/LoanVault.Invariant.t.sol`

**Interfaces:**
- Consumes: Task 1 vault (`orders`, `OrderStatus.Open`, `_isRole`).
- Produces:
  - `mapping(uint256 => uint256) public supplierCost;` `uint256 public uniqueBuyers;` `mapping(address => bool) public seenBuyer;`
  - `error OverOrderPrice();` `error BuyerNotAllowed();`
  - `paySupplier(address supplier, uint256 amount, uint256 orderId)`: also requires `orders[orderId].status == Open` (`OrderNotOpen`) and `supplierCost[orderId] + amount <= price` (`OverOrderPrice`).
  - `buy(uint256 serviceId, bytes32 requestRef)`: refuses `ownerPq`, `ownerPayout`, `spender`, `operator` and allowed suppliers (`BuyerNotAllowed`); counts `uniqueBuyers`.

- [ ] **Step 1: Write the failing tests**

Replace `sc/test/LoanVault.Suppliers.t.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultSuppliersTest is Base {
    function setUp() public override {
        super.setUp();
        _activate();
    }

    /// Pays `supplier` for a fresh 100 fUSD order, so the order price never limits the payment.
    function _pay(address supplier, uint256 amount) internal returns (uint256 id) {
        id = _buy(2);
        vm.prank(spender);
        vault.paySupplier(supplier, amount, id);
    }

    function test_spenderPaysListedSupplier() public {
        uint256 id = _buy(2);
        vm.expectEmit(address(vault));
        emit LoanVault.SupplierPaid(supplierA, 3e18, id);
        vm.prank(spender);
        vault.paySupplier(supplierA, 3e18, id);
        assertEq(fusd.balanceOf(supplierA), 3e18);
        assertEq(vault.opexBalance(), TARGET - 3e18);
        assertEq(vault.spentToday(), 3e18);
        assertEq(vault.supplierCost(id), 3e18);
    }

    function test_onlySpenderPays() public {
        uint256 id = _buy(2);
        vm.prank(operator);
        vm.expectRevert(LoanVault.NotSpender.selector);
        vault.paySupplier(supplierA, 1e18, id);
        vm.prank(ownerPq);
        vm.expectRevert(LoanVault.NotSpender.selector);
        vault.paySupplier(supplierA, 1e18, id);
    }

    function test_unlistedSupplierReverts() public {
        uint256 id = _buy(2);
        vm.prank(spender);
        vm.expectRevert(LoanVault.SupplierNotAllowed.selector);
        vault.paySupplier(stranger, 1e18, id);
    }

    function test_overSupplierCapReverts() public {
        uint256 id = _buy(2);
        vm.prank(spender);
        vm.expectRevert(LoanVault.OverSupplierCap.selector);
        vault.paySupplier(supplierB, CAP_B + 1, id);
    }

    function test_zeroPaymentReverts() public {
        uint256 id = _buy(2);
        vm.prank(spender);
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.paySupplier(supplierA, 0, id);
    }

    function test_dailyCapAndReset() public {
        _pay(supplierA, 10e18);
        _pay(supplierA, 10e18);
        uint256 id = _buy(2);
        vm.prank(spender);
        vm.expectRevert(LoanVault.OverDailyCap.selector);
        vault.paySupplier(supplierB, 1, id);
        vm.warp(block.timestamp + 1 days);
        _pay(supplierB, 1e18);
        assertEq(vault.spentToday(), 1e18);
    }

    function test_cannotSpendMoreThanOpex() public {
        uint256 t = block.timestamp;
        for (uint256 d; d < 5; d++) {
            _pay(supplierA, 10e18);
            _pay(supplierA, 10e18);
            t += 1 days;
            vm.warp(t);
        }
        assertEq(vault.opexBalance(), 0);
        uint256 id = _buy(2);
        vm.prank(spender);
        vm.expectRevert(LoanVault.InsufficientOpex.selector);
        vault.paySupplier(supplierA, 1, id);
    }

    function test_noPaymentsBeforeActivation() public {
        LoanVault fresh = _create(_init());
        vm.prank(spender);
        vm.expectRevert(LoanVault.WrongState.selector);
        fresh.paySupplier(supplierA, 1, 1);
    }

    function test_paymentNeedsAnOpenOrder() public {
        vm.prank(spender);
        vm.expectRevert(LoanVault.OrderNotOpen.selector);
        vault.paySupplier(supplierA, 1, 99);
        uint256 id = _buy(1);
        vm.prank(operator);
        vault.decline(id, 1);
        vm.prank(spender);
        vm.expectRevert(LoanVault.OrderNotOpen.selector);
        vault.paySupplier(supplierA, 1, id);
    }

    function test_paymentsForOneOrderStopAtItsPrice() public {
        uint256 id = _buy(0); // 1 fUSD
        vm.startPrank(spender);
        vault.paySupplier(supplierA, 0.6e18, id);
        vm.expectRevert(LoanVault.OverOrderPrice.selector);
        vault.paySupplier(supplierA, 0.5e18, id);
        vault.paySupplier(supplierB, 0.4e18, id);
        vm.expectRevert(LoanVault.OverOrderPrice.selector);
        vault.paySupplier(supplierA, 1, id);
        vm.stopPrank();
        assertEq(vault.supplierCost(id), PRICE0);
    }

    function test_costIsCountedPerOrder() public {
        uint256 a = _buy(0);
        uint256 b = _buy(0);
        vm.startPrank(spender);
        vault.paySupplier(supplierA, PRICE0, a);
        vault.paySupplier(supplierA, PRICE0, b);
        vm.stopPrank();
        assertEq(vault.supplierCost(a), PRICE0);
        assertEq(vault.supplierCost(b), PRICE0);
    }

    function testFuzz_paymentNeverExceedsCaps(uint256 amount) public {
        amount = bound(amount, 1, 50e18);
        uint256 id = _buy(2);
        vm.prank(spender);
        if (amount > CAP_A) {
            vm.expectRevert(LoanVault.OverSupplierCap.selector);
            vault.paySupplier(supplierA, amount, id);
        } else {
            vault.paySupplier(supplierA, amount, id);
            assertLe(vault.spentToday(), DAILY);
            assertEq(vault.supplierCost(id), amount);
        }
    }
}
```

Append to `sc/test/LoanVault.Orders.t.sol` (inside the contract):

```solidity
    function test_rolesAndSuppliersCannotBuy() public {
        address[6] memory refused = [ownerPq, ownerPayout, spender, operator, supplierA, supplierB];
        for (uint256 k; k < refused.length; k++) {
            fusd.mint(refused[k], PRICE0);
            vm.startPrank(refused[k]);
            fusd.approve(address(vault), PRICE0);
            vm.expectRevert(LoanVault.BuyerNotAllowed.selector);
            vault.buy(0, bytes32(0));
            vm.stopPrank();
        }
        assertEq(vault.orderCount(), 0);
    }

    function test_uniqueBuyersCountsFirstPurchasesOnly() public {
        _buy(0);
        _buy(1);
        assertEq(vault.uniqueBuyers(), 1);
        assertTrue(vault.seenBuyer(buyer));
        fusd.mint(stranger, PRICE0);
        vm.startPrank(stranger);
        fusd.approve(address(vault), PRICE0);
        vault.buy(0, bytes32(0));
        vm.stopPrank();
        assertEq(vault.uniqueBuyers(), 2);
    }
```

In `sc/test/LoanVault.Invariant.t.sol` replace the handler's `pay` (a payment now needs an order):

```solidity
    function pay(uint256 amount) external {
        uint256 id = vault.orderCount();
        if (id == 0) return;
        amount = bound(amount, 1, 10e18);
        vm.prank(spender);
        try vault.paySupplier(supplier, amount, id) {
            supplierPayments++;
        } catch {}
    }
```

- [ ] **Step 2: Run the tests and see them fail**

Run (in `sc/`): `forge test --match-contract "LoanVaultSuppliersTest|LoanVaultOrdersTest"`
Expected: compilation fails with `Member "supplierCost" not found` and `Member "BuyerNotAllowed" not found`.

- [ ] **Step 3: Implement**

In `sc/src/LoanVault.sol` extend the orders storage block:

```solidity
    // Orders
    uint256 public orderCount;
    mapping(uint256 => Order) public orders;
    /// What the spender paid suppliers for each order; never above the order's price.
    mapping(uint256 => uint256) public supplierCost;
    /// Buyers counted once each; the owner's own roles and the suppliers cannot buy.
    uint256 public uniqueBuyers;
    mapping(address => bool) public seenBuyer;
```

Add `error OverOrderPrice();` and `error BuyerNotAllowed();` after `error BadOrder();`. Replace `buy` and `paySupplier`:

```solidity
    function buy(uint256 serviceId, bytes32 requestRef) external returns (uint256 id) {
        if (activatedAt == 0) revert WrongState();
        if (paused) revert Paused();
        if (serviceId >= servicePrices.length) revert UnknownService();
        if (_isRole(msg.sender, spender, operator, ownerPq, ownerPayout) || suppliers[msg.sender].allowed) {
            revert BuyerNotAllowed();
        }
        if (!seenBuyer[msg.sender]) {
            seenBuyer[msg.sender] = true;
            uniqueBuyers++;
        }
        uint256 price = servicePrices[serviceId];
        token.safeTransferFrom(msg.sender, address(this), price);
        id = ++orderCount;
        uint64 deadline = uint64(block.timestamp) + orderTtl;
        orders[id] = Order(msg.sender, uint32(serviceId), deadline, OrderStatus.Open, price, requestRef);
        escrowTotal += price;
        emit OrderPlaced(id, msg.sender, serviceId, price, requestRef, deadline);
    }
```

```solidity
    /// Pays a listed supplier for one open order. The spend on an order never exceeds its price, so moving principal
    /// to a supplier needs real buyer money of at least the same amount.
    function paySupplier(address supplier, uint256 amount, uint256 orderId) external {
        if (msg.sender != spender) revert NotSpender();
        if (activatedAt == 0) revert WrongState();
        if (paused) revert Paused();
        Supplier memory s = suppliers[supplier];
        if (!s.allowed) revert SupplierNotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (amount > s.perTxCap) revert OverSupplierCap();
        Order storage o = orders[orderId];
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        uint256 cost = supplierCost[orderId] + amount;
        if (cost > o.price) revert OverOrderPrice();
        uint64 today = uint64(block.timestamp / 1 days);
        if (today != dayIndex) {
            dayIndex = today;
            spentToday = 0;
        }
        if (spentToday + amount > dailyCap) revert OverDailyCap();
        if (amount > opexBalance) revert InsufficientOpex();
        supplierCost[orderId] = cost;
        spentToday += amount;
        opexBalance -= amount;
        token.safeTransfer(supplier, amount);
        emit SupplierPaid(supplier, amount, orderId);
    }
```

The order check sits after the supplier checks, so `LoanVault.Policy.t.sol` (which pays order 1 after a removal or a pause and expects `SupplierNotAllowed` or `Paused`) keeps passing unchanged.

- [ ] **Step 4: Run the tests and see them pass**

Run (in `sc/`): `forge test`
Expected: all suites pass; `LoanVaultSuppliersTest` 12 tests; `LoanVaultOrdersTest` includes the two buyer tests.

- [ ] **Step 5: Commit**

```bash
git add sc/src/LoanVault.sol sc/test/LoanVault.Suppliers.t.sol sc/test/LoanVault.Orders.t.sol sc/test/LoanVault.Invariant.t.sol
git commit -m "feat(sc): supplier cost per order and buyer restrictions" -m "Vault v2 (spec sections 4 and 8, holes K1 and K7): paySupplier needs an open order and refuses a spend above that order's price (OverOrderPrice), so a fake supplier can only drain principal with real buyer money; the owner's roles and the suppliers cannot buy (BuyerNotAllowed), and uniqueBuyers counts first-time buyers. Tests: forge test (all suites)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Contract: buyer review (deliver, accept, settle, reject) and decline with cost

**Files:**
- Modify: `sc/src/LoanVault.sol`
- Create: `sc/test/LoanVault.Review.t.sol`
- Modify: `sc/test/Base.t.sol`, `sc/test/LoanVault.Orders.t.sol`, `sc/test/LoanVault.Claims.t.sol`, `sc/test/LoanVault.Fuzz.t.sol`, `sc/test/LoanVault.Invariant.t.sol`

**Interfaces:**
- Consumes: Task 2 `supplierCost`.
- Produces:
  - `uint64 public constant REVIEW_WINDOW = 24 hours;`
  - `enum OrderStatus { None, Open, InReview, Settled, Rejected, Declined, Reclaimed }`
  - `struct Order { address buyer; uint32 serviceId; uint64 deadline; OrderStatus status; uint256 price; bytes32 requestRef; uint64 reviewEnds; }`
  - `deliver(uint256 id, bytes32 envelopeHash)` sets `InReview`; `event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 reviewEnds)`
  - `accept(uint256 id)`, `settle(uint256 id)`, `reject(uint256 id)`; `event Settled(uint256 indexed orderId, uint256 toLenders, uint256 toOwner, uint256 toOpex)`, `event Rejected(uint256 indexed orderId, uint256 refund, uint256 cost)`
  - `error NotInReview(); error ReviewOpen(); error ReviewOver();`
  - internal `_settle(uint256 id, Order storage o)`, `_refundKeepingCost(uint256 id, Order storage o) returns (uint256 refund, uint256 cost)`
  - `Base`: `_accept(uint256 id)`, `_settleNow(uint256 id)`; `_sell` delivers and accepts.

- [ ] **Step 1: Write the failing tests**

In `sc/test/Base.t.sol` add after `_deliver` and replace `_sell`:

```solidity
    function _accept(uint256 id) internal {
        vm.prank(buyer);
        vault.accept(id);
    }

    /// Delivers and lets the buyer accept at once: the sale is split now.
    function _settleNow(uint256 id) internal {
        _deliver(id);
        _accept(id);
    }

    function _sell(uint256 serviceId, uint256 n) internal {
        for (uint256 k; k < n; k++) {
            _settleNow(_buy(serviceId));
        }
    }
```

Create `sc/test/LoanVault.Review.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultReviewTest is Base {
    function setUp() public override {
        super.setUp();
        _activate();
    }

    function _status(uint256 id) internal view returns (LoanVault.OrderStatus st) {
        (,,, st,,,) = vault.orders(id);
    }

    function _reviewEnds(uint256 id) internal view returns (uint64 ends) {
        (,,,,,, ends) = vault.orders(id);
    }

    function _paySupplier(uint256 id, uint256 amount) internal {
        vm.prank(spender);
        vault.paySupplier(supplierA, amount, id);
    }

    function test_deliverOpensTheReviewAndKeepsEscrow() public {
        uint256 id = _buy(1);
        vm.expectEmit(address(vault));
        emit LoanVault.Delivered(id, keccak256(abi.encode("envelope", id)), block.timestamp + 24 hours);
        _deliver(id);
        assertEq(uint8(_status(id)), uint8(LoanVault.OrderStatus.InReview));
        assertEq(_reviewEnds(id), block.timestamp + vault.REVIEW_WINDOW());
        assertEq(vault.escrowTotal(), PRICE1);
        assertEq(vault.repaid(), 0);
        assertEq(vault.ownerPending(), 0);
    }

    function test_acceptSplitsLendersFirst() public {
        uint256 id = _buy(1); // 5 fUSD
        _deliver(id);
        vm.expectEmit(address(vault));
        emit LoanVault.Settled(id, 1.5e18, 1e18, 2.5e18);
        _accept(id);
        assertEq(vault.repaid(), 1.5e18);
        assertEq(vault.lenderPool(), 1.5e18);
        assertEq(vault.ownerPending(), 1e18);
        assertEq(vault.opexBalance(), TARGET + 2.5e18);
        assertEq(vault.escrowTotal(), 0);
        assertEq(uint8(_status(id)), uint8(LoanVault.OrderStatus.Settled));
    }

    function test_onlyTheBuyerAccepts() public {
        uint256 id = _buy(1);
        _deliver(id);
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotBuyer.selector);
        vault.accept(id);
    }

    function test_acceptNeedsAnOrderInReview() public {
        uint256 id = _buy(1);
        vm.prank(buyer);
        vm.expectRevert(LoanVault.NotInReview.selector);
        vault.accept(id);
        _settleNow(id);
        vm.prank(buyer);
        vm.expectRevert(LoanVault.NotInReview.selector);
        vault.accept(id);
    }

    function test_anyoneSettlesOnceTheReviewEnds() public {
        uint256 id = _buy(1);
        _deliver(id);
        uint256 ends = _reviewEnds(id);
        vm.warp(ends);
        vm.prank(stranger);
        vm.expectRevert(LoanVault.ReviewOpen.selector);
        vault.settle(id);
        vm.warp(ends + 1);
        // Still in the grace period (GRACE = PERIOD = 1 day, one day has passed), so the vault is Active.
        vm.expectEmit(address(vault));
        emit LoanVault.Settled(id, 1.5e18, 1e18, 2.5e18);
        vm.prank(stranger);
        vault.settle(id);
        assertEq(uint8(_status(id)), uint8(LoanVault.OrderStatus.Settled));
    }

    function test_settleBeforeDeliveryRefused() public {
        uint256 id = _buy(1);
        vm.expectRevert(LoanVault.NotInReview.selector);
        vault.settle(id);
    }

    function test_rejectRefundsThePriceLessTheSupplierCost() public {
        uint256 id = _buy(1); // 5 fUSD
        _paySupplier(id, 2e18);
        _deliver(id);
        uint256 before = fusd.balanceOf(buyer);
        vm.expectEmit(address(vault));
        emit LoanVault.Rejected(id, 3e18, 2e18);
        vm.prank(buyer);
        vault.reject(id);
        assertEq(fusd.balanceOf(buyer), before + 3e18);
        assertEq(vault.opexBalance(), TARGET, "the cost spent on the order comes back to opex");
        assertEq(vault.escrowTotal(), 0);
        assertEq(vault.repaid(), 0);
        assertEq(uint8(_status(id)), uint8(LoanVault.OrderStatus.Rejected));
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function test_rejectWithoutCostRefundsThePrice() public {
        uint256 id = _buy(1);
        _deliver(id);
        uint256 before = fusd.balanceOf(buyer);
        vm.prank(buyer);
        vault.reject(id);
        assertEq(fusd.balanceOf(buyer), before + PRICE1);
    }

    function test_rejectAtReviewEndWorksAndAfterIsRefused() public {
        uint256 a = _buy(1);
        _deliver(a);
        vm.warp(_reviewEnds(a));
        vm.prank(buyer);
        vault.reject(a);
        uint256 b = _buy(1);
        _deliver(b);
        vm.warp(uint256(_reviewEnds(b)) + 1);
        vm.prank(buyer);
        vm.expectRevert(LoanVault.ReviewOver.selector);
        vault.reject(b);
    }

    function test_onlyTheBuyerRejects() public {
        uint256 id = _buy(1);
        _deliver(id);
        vm.prank(operator);
        vm.expectRevert(LoanVault.NotBuyer.selector);
        vault.reject(id);
    }

    function test_rejectedOrderCannotBeSettledOrAccepted() public {
        uint256 id = _buy(1);
        _deliver(id);
        vm.prank(buyer);
        vault.reject(id);
        vm.warp(uint256(_reviewEnds(id)) + 1);
        vm.expectRevert(LoanVault.NotInReview.selector);
        vault.settle(id);
        vm.prank(buyer);
        vm.expectRevert(LoanVault.NotInReview.selector);
        vault.accept(id);
    }

    function test_declineKeepsTheSupplierCost() public {
        uint256 id = _buy(1);
        _paySupplier(id, 2e18);
        uint256 before = fusd.balanceOf(buyer);
        vm.prank(operator);
        vault.decline(id, 6);
        assertEq(fusd.balanceOf(buyer), before + 3e18);
        assertEq(vault.opexBalance(), TARGET);
        assertEq(uint8(_status(id)), uint8(LoanVault.OrderStatus.Declined));
    }

    function test_reviewRunsPastTheOrderDeadline() public {
        uint256 id = _buy(1);
        (,, uint64 deadline,,,,) = vault.orders(id);
        vm.warp(deadline);
        _deliver(id);
        vm.warp(uint256(deadline) + 1);
        vm.prank(buyer);
        vault.reject(id);
        assertEq(uint8(_status(id)), uint8(LoanVault.OrderStatus.Rejected));
    }

    function test_reclaimRefusedOnceDelivered() public {
        uint256 id = _buy(1);
        _deliver(id);
        (,, uint64 deadline,,,,) = vault.orders(id);
        vm.warp(uint256(deadline) + 1);
        vm.prank(buyer);
        vm.expectRevert(LoanVault.OrderNotOpen.selector);
        vault.reclaim(id);
    }
}
```

Edit the existing tests for the review step (exact replacements):
- `LoanVault.Orders.t.sol`: delete `test_deliverSplitsLendersFirst` (it became `test_acceptSplitsLendersFirst`); in `test_buyEscrowsPayment` use `(address b, uint32 sid, uint64 deadline, LoanVault.OrderStatus st, uint256 price,,) = vault.orders(id);`; every `(,,, LoanVault.OrderStatus st,,)` becomes `(,,, LoanVault.OrderStatus st,,,)` and every `(,, uint64 deadline,,,)` becomes `(,, uint64 deadline,,,,)`; in `test_deliverAtDeadlineOkAndReclaimRefused` the expected status is `LoanVault.OrderStatus.InReview`.
- `LoanVault.Claims.t.sol`: in `test_trappedRedirectsOwnerShareToLenders` and `test_repaidCapsLenderShare` replace `vm.expectEmit(address(vault)); emit LoanVault.Delivered(id, keccak256(abi.encode("envelope", id)), A, B, C); _deliver(id);` with `_deliver(id); vm.expectEmit(address(vault)); emit LoanVault.Settled(id, A, B, C); _accept(id);` keeping the same `A, B, C`; in `test_businessKeepsSellingAfterRepaid` replace `_deliver(id);` with `_settleNow(id);`, the destructuring with `(,,, LoanVault.OrderStatus st,,,)` and the expected status with `LoanVault.OrderStatus.Settled`; in `test_oddDepositsAndPricesRoundDownSafely` and `test_oddDepositsAndPricesAtSixDecimalScale` replace `_deliver(_buy(` with `_settleNow(_buy(`.
- `LoanVault.Fuzz.t.sol`: replace both `_deliver(_buy(` with `_settleNow(_buy(`.
- `LoanVault.Invariant.t.sol`: in the handler, replace `_deliver` and add `accept` (the split and the owner ghost move to the settlement):

```solidity
    uint256 public settlements;

    function _deliver(uint256 id) internal {
        vm.prank(operator);
        try vault.deliver(id, bytes32(id)) {
            deliveries++;
        } catch {}
    }

    function accept(uint256 id) external {
        if (vault.orderCount() == 0) return;
        id = bound(id, 1, vault.orderCount());
        (,,,, uint256 price,,) = vault.orders(id);
        vm.prank(buyer);
        try vault.accept(id) {
            settlements++;
            ownerEntitledMax += price * vault.ownerBps() / 10_000;
        } catch {}
    }
```

- [ ] **Step 2: Run the tests and see them fail**

Run (in `sc/`): `forge test`
Expected: compilation fails with `Member "accept" not found` and `Member "InReview" not found`.

- [ ] **Step 3: Implement**

In `sc/src/LoanVault.sol` add `uint64 public constant REVIEW_WINDOW = 24 hours;` after `BOND_BPS`, and replace the order enum and struct:

```solidity
    enum OrderStatus { None, Open, InReview, Settled, Rejected, Declined, Reclaimed }

    struct Order {
        address buyer;
        uint32 serviceId;
        uint64 deadline;
        OrderStatus status;
        uint256 price;
        bytes32 requestRef;
        /// Set by deliver: until then the buyer may reject; after it anyone may settle.
        uint64 reviewEnds;
    }
```

Replace the `Delivered` event and add the new events and errors:

```solidity
    event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 reviewEnds);
    event Settled(uint256 indexed orderId, uint256 toLenders, uint256 toOwner, uint256 toOpex);
    event Rejected(uint256 indexed orderId, uint256 refund, uint256 cost);
```

```solidity
    error NotInReview();
    error ReviewOpen();
    error ReviewOver();
```

In `buy` the stored order becomes `orders[id] = Order(msg.sender, uint32(serviceId), deadline, OrderStatus.Open, price, requestRef, 0);`. Replace `deliver` and `decline`, and add `accept`, `settle`, `reject`, `_settle` and `_refundKeepingCost` in the orders section:

```solidity
    /// The operator hands over the sealed report. The payment stays in escrow while the buyer reviews it.
    function deliver(uint256 id, bytes32 envelopeHash) external {
        if (msg.sender != operator) revert NotOperator();
        Order storage o = orders[id];
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        if (block.timestamp > o.deadline) revert OrderExpired();
        uint64 ends = uint64(block.timestamp) + REVIEW_WINDOW;
        o.status = OrderStatus.InReview;
        o.reviewEnds = ends;
        emit Delivered(id, envelopeHash, ends);
    }

    /// The buyer accepts the report: the sale settles at once.
    function accept(uint256 id) external {
        Order storage o = orders[id];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.status != OrderStatus.InReview) revert NotInReview();
        _settle(id, o);
    }

    /// Anyone settles a delivered order once its review has ended without a rejection.
    function settle(uint256 id) external {
        Order storage o = orders[id];
        if (o.status != OrderStatus.InReview) revert NotInReview();
        if (block.timestamp <= o.reviewEnds) revert ReviewOpen();
        _settle(id, o);
    }

    /// The buyer rejects the report during the review: the price comes back less what the agent already spent on it.
    function reject(uint256 id) external {
        Order storage o = orders[id];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.status != OrderStatus.InReview) revert NotInReview();
        if (block.timestamp > o.reviewEnds) revert ReviewOver();
        o.status = OrderStatus.Rejected;
        (uint256 refund, uint256 cost) = _refundKeepingCost(id, o);
        emit Rejected(id, refund, cost);
    }

    /// The operator refuses an open order: the buyer gets the price back less what the agent spent before declining.
    function decline(uint256 id, uint8 reasonCode) external {
        if (msg.sender != operator) revert NotOperator();
        Order storage o = orders[id];
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        o.status = OrderStatus.Declined;
        _refundKeepingCost(id, o);
        emit Declined(id, reasonCode);
    }

    function _settle(uint256 id, Order storage o) internal {
        o.status = OrderStatus.Settled;
        escrowTotal -= o.price;
        (uint256 toLenders, uint256 toOwner, uint256 toOpex) = _split(o.price);
        emit Settled(id, toLenders, toOwner, toOpex);
    }

    /// Releases an order's escrow: the supplier cost spent on it stays in the vault, the rest goes back to the buyer.
    function _refundKeepingCost(uint256 id, Order storage o) internal returns (uint256 refund, uint256 cost) {
        uint256 spent = supplierCost[id];
        cost = spent < o.price ? spent : o.price;
        refund = o.price - cost;
        escrowTotal -= o.price;
        opexBalance += cost;
        if (refund > 0) token.safeTransfer(o.buyer, refund);
    }
```

`reclaim` keeps its v1 body (full price, `Open` orders only).

- [ ] **Step 4: Run the tests and see them pass**

Run (in `sc/`): `forge test`
Expected: all suites pass, `LoanVaultReviewTest` 14 tests.

- [ ] **Step 5: Commit**

```bash
git add sc/src/LoanVault.sol sc/test/LoanVault.Review.t.sol sc/test/Base.t.sol sc/test/LoanVault.Orders.t.sol sc/test/LoanVault.Claims.t.sol sc/test/LoanVault.Fuzz.t.sol sc/test/LoanVault.Invariant.t.sol
git commit -m "feat(sc): buyer review before a sale is split" -m "Vault v2 (spec section 5, hole K4): deliver keeps the escrow and opens a 24 h review; the buyer accepts or rejects (refund = price minus supplier cost), anyone settles after the review, and decline also keeps the supplier cost in opex. Delivered carries reviewEnds and the split moves to Settled. Tests: forge test (all suites, new LoanVaultReviewTest)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Contract: owner claim one installment ahead, default, Close and the ending sweep

**Files:**
- Modify: `sc/src/LoanVault.sol`
- Create: `sc/test/LoanVault.Default.t.sol`
- Modify: `sc/test/LoanVault.Claims.t.sol`, `sc/test/LoanVault.Policy.t.sol`

**Interfaces:**
- Consumes: Task 1 `ended`, `EndKind`, `bondHeld`; Task 3 `_settle`, `_refundKeepingCost`.
- Produces:
  - `enum Kind { RemoveSupplier, LowerSupplierCap, LowerDailyCap, Pause, Unpause, AddSupplier, RaiseSupplierCap, RaiseDailyCap, Close }`
  - `uint256 public swept;` (total moved to lenders outside the schedule)
  - `function claimOwner() external` (Active and `repaid >= expectedRepaid(now + period)`, or Repaid; else `OwnerClaimNotAhead`)
  - `function defaultable() public view returns (bool)`, `function triggerDefault() external`
  - `event LoanEnded(uint8 kind)`; `error Ended(); error OwnerClaimNotAhead(); error NotDefaultable();` (`TrappedNoOwnerClaim` removed)
  - internal `_notEnded()`, `_end(EndKind kind)`, `_toLenders(uint256 amount)`, `_widens(Kind k) returns (bool)`

- [ ] **Step 1: Write the failing tests**

Create `sc/test/LoanVault.Default.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultDefaultTest is Base {
    uint8 internal constant PAUSE = 3;
    uint8 internal constant CLOSE = 8;

    function setUp() public override {
        super.setUp();
        _activate();
    }

    function _apply(LoanVault.PolicyOrder memory o) internal {
        bytes memory sig = _sign(o); // compute first: _sign makes an external call that would consume the prank
        vm.prank(stranger);
        vault.applyOrder(o, sig);
    }

    function test_defaultAfterThreeMissedInstallments() public {
        uint256 t0 = block.timestamp;
        vm.warp(t0 + GRACE + 3 * PERIOD - 1); // two installments due
        assertFalse(vault.defaultable());
        vm.expectRevert(LoanVault.NotDefaultable.selector);
        vault.triggerDefault();
        vm.warp(t0 + GRACE + 3 * PERIOD); // three due, none paid
        assertTrue(vault.defaultable());
        vm.expectEmit(address(vault));
        emit LoanVault.LoanEnded(1);
        vm.prank(stranger);
        vault.triggerDefault();
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Defaulted));
        assertEq(uint8(vault.ended()), uint8(LoanVault.EndKind.Defaulted));
    }

    function test_defaultPastMaturityAndItsGrace() public {
        LoanVault.Init memory i = _init();
        i.loan.defaultAfterMissed = 100; // never reached here, so only maturity can end the loan
        _freshWith(i, 60e18, 40e18);
        uint256 t0 = block.timestamp;
        vm.warp(t0 + MATURITY + MATURITY_GRACE);
        assertFalse(vault.defaultable());
        vm.warp(t0 + MATURITY + MATURITY_GRACE + 1);
        assertTrue(vault.defaultable());
        vault.triggerDefault();
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Defaulted));
    }

    function test_endingSweepsOpexOwnerShareAndBondToLenders() public {
        _sell(1, 2); // lenders 3, owner 2, opex + 5
        uint256 pool = vault.lenderPool();
        uint256 repaid = vault.repaid();
        uint256 sweep = vault.opexBalance() + vault.ownerPending() + BOND;
        uint256 t = block.timestamp + GRACE + 4 * PERIOD; // 40 due, 3 repaid: 37 behind
        vm.warp(t);
        vault.triggerDefault();
        assertEq(vault.lenderPool(), pool + sweep);
        assertEq(vault.swept(), sweep);
        assertEq(vault.repaid(), repaid, "the sweep is not a repayment");
        assertEq(vault.opexBalance(), 0);
        assertEq(vault.ownerPending(), 0);
        assertEq(vault.bondHeld(), 0);
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
        uint256 a0 = fusd.balanceOf(lenderA);
        uint256 b0 = fusd.balanceOf(lenderB);
        vm.prank(lenderA);
        vault.claimLender();
        vm.prank(lenderB);
        vault.claimLender();
        uint256 gotA = fusd.balanceOf(lenderA) - a0;
        uint256 got = gotA + fusd.balanceOf(lenderB) - b0;
        assertLe(got, pool + sweep);
        assertLe(pool + sweep - got, 2, "dust must not exceed the number of lenders");
        assertApproxEqAbs(gotA, (pool + sweep) * 60 / 100, 1);
    }

    function test_endedVaultRefusesNewBusiness() public {
        uint256 id = _buy(2); // placed before the end
        uint256 t = block.timestamp + GRACE + 3 * PERIOD;
        vm.warp(t);
        vault.triggerDefault();
        vm.prank(buyer);
        vm.expectRevert(LoanVault.Ended.selector);
        vault.buy(0, bytes32(0));
        vm.prank(spender);
        vm.expectRevert(LoanVault.Ended.selector);
        vault.paySupplier(supplierA, 1, id);
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.Ended.selector);
        vault.deposit(1);
        vm.expectRevert(LoanVault.Ended.selector);
        vault.claimOwner();
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.Ended.selector);
        vault.applyOrder(o, sig);
        vm.expectRevert(LoanVault.Ended.selector);
        vault.triggerDefault();
    }

    function test_ordersPlacedBeforeTheEndFinishForLenders() public {
        uint256 a = _buy(1);
        uint256 b = _buy(1);
        uint256 c = _buy(1);
        vm.prank(spender);
        vault.paySupplier(supplierA, 2e18, b);
        _deliver(a);
        _deliver(b);
        _apply(_order(CLOSE, address(0), 0));
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Closed));
        uint256 pool = vault.lenderPool();
        vm.expectEmit(address(vault));
        emit LoanVault.Settled(a, PRICE1, 0, 0);
        _accept(a);
        assertEq(vault.lenderPool(), pool + PRICE1, "after the end the whole price goes to lenders");
        uint256 before = fusd.balanceOf(buyer);
        vm.prank(buyer);
        vault.reject(b);
        assertEq(fusd.balanceOf(buyer), before + 3e18);
        assertEq(vault.lenderPool(), pool + PRICE1 + 2e18, "the kept cost goes to lenders");
        _deliver(c); // still allowed before its deadline
        (,,, LoanVault.OrderStatus st,,,) = vault.orders(c);
        assertEq(uint8(st), uint8(LoanVault.OrderStatus.InReview));
        assertEq(vault.opexBalance(), 0);
        assertEq(vault.repaid(), 0, "nothing after the end counts as a repayment");
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function test_onlyARunningLoanCanDefault() public {
        LoanVault raising = _create(_init());
        uint256 t = block.timestamp + MATURITY + MATURITY_GRACE + 30 days;
        vm.warp(t);
        assertFalse(raising.defaultable());
        vm.expectRevert(LoanVault.NotDefaultable.selector);
        raising.triggerDefault();
    }

    function test_repaidLoanCannotDefault() public {
        _sell(2, 4);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        uint256 t = block.timestamp + MATURITY + MATURITY_GRACE + 1;
        vm.warp(t);
        vm.expectRevert(LoanVault.NotDefaultable.selector);
        vault.triggerDefault();
    }

    function test_loanOnScheduleCannotDefault() public {
        uint256 t = block.timestamp + GRACE + 3 * PERIOD;
        vm.warp(t);
        _sell(2, 1); // Trapped sale: 50 fUSD to lenders, 30 due
        vm.expectRevert(LoanVault.NotDefaultable.selector);
        vault.triggerDefault();
    }

    function test_closeOrderEndsTheLoan() public {
        _sell(1, 1);
        uint256 sweep = vault.opexBalance() + vault.ownerPending() + BOND;
        uint256 pool = vault.lenderPool();
        vm.expectEmit(address(vault));
        emit LoanVault.LoanEnded(2);
        _apply(_order(CLOSE, address(0), 0));
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Closed));
        assertEq(vault.lenderPool(), pool + sweep);
    }

    function test_closeWorksWhileTrapped() public {
        uint256 t = block.timestamp + GRACE + PERIOD;
        vm.warp(t);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Trapped));
        _apply(_order(CLOSE, address(0), 0));
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Closed));
    }

    function test_closeRefusedWhenRepaid() public {
        _sell(2, 4);
        LoanVault.PolicyOrder memory o = _order(CLOSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.applyOrder(o, sig);
    }

    function test_closeRefusedWhileRaising() public {
        vault = _create(_init());
        LoanVault.PolicyOrder memory o = _order(CLOSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.applyOrder(o, sig);
    }

    function test_closeSignedByAnotherKeyRefused() public {
        LoanVault.PolicyOrder memory o = _order(CLOSE, address(0), 0);
        vm.expectRevert(LoanVault.BadPqcSignature.selector);
        vault.applyOrder(o, hex"deadbeef");
        assertEq(uint8(vault.ended()), uint8(LoanVault.EndKind.None));
    }
}
```

Edit `sc/test/LoanVault.Claims.t.sol`: in `test_ownerCannotClaimWhileTrapped` expect `LoanVault.OwnerClaimNotAhead.selector`; replace `test_claimOwnerWorksAgainAfterTrappedReturnsToActive` with:

```solidity
    function test_ownerClaimNeedsOneInstallmentAhead() public {
        _sell(1, 1); // owner earns 1 fUSD while Active
        uint256 t = block.timestamp + GRACE + PERIOD;
        vm.warp(t);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Trapped));
        _sell(1, 4); // 4 x 2.5 to lenders while Trapped: repaid 11.5, 10 due
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Active));
        // On schedule but not ahead: expectedRepaid(now + period) is 20.
        vm.expectRevert(LoanVault.OwnerClaimNotAhead.selector);
        vault.claimOwner();
        _sell(1, 6); // 6 x 1.5 to lenders while Active: repaid 20.5
        assertEq(vault.ownerPending(), 7e18, "1 + 6 x 1 kept while waiting");
        vault.claimOwner();
        assertEq(fusd.balanceOf(ownerPayout), 7e18);
    }
```

Edit `sc/test/LoanVault.Policy.t.sol`: in `test_unknownKindReverts` use `_order(9, address(0), 0)`.

- [ ] **Step 2: Run the tests and see them fail**

Run (in `sc/`): `forge test`
Expected: compilation fails with `Member "triggerDefault" not found` and `Member "OwnerClaimNotAhead" not found`.

- [ ] **Step 3: Implement**

In `sc/src/LoanVault.sol`: append `Close` to `Kind`; add `uint256 public swept;` after `accPerShare`; add `event LoanEnded(uint8 kind);`; add `error Ended(); error OwnerClaimNotAhead(); error NotDefaultable();` and delete `error TrappedNoOwnerClaim();`.

Add `_notEnded();` as the first line of `deposit` and `buy`, and right after the `NotSpender` check in `paySupplier`. Replace `claimOwner`, `applyOrder`, `_apply`, `_settle` and `_refundKeepingCost`, and add the ending functions:

```solidity
    /// The owner's share is paid only while the loan is one installment ahead of schedule, or once it is repaid.
    function claimOwner() external {
        _notEnded();
        State s = state();
        bool ahead = s == State.Active && repaid >= expectedRepaid(block.timestamp + loan.period);
        if (s != State.Repaid && !ahead) revert OwnerClaimNotAhead();
        uint256 amount = ownerPending;
        if (amount == 0) revert ZeroAmount();
        ownerPending = 0;
        token.safeTransfer(ownerPayout, amount);
        emit OwnerClaimed(amount);
    }

    /// True when anyone may end the loan as Defaulted now: it runs (Active or Trapped) and is either
    /// `defaultAfterMissed` installments behind the schedule or past maturity plus its grace.
    function defaultable() public view returns (bool) {
        if (ended != EndKind.None) return false;
        State s = state();
        if (s != State.Active && s != State.Trapped) return false;
        uint256 due = expectedRepaid(block.timestamp);
        if (due > repaid && due - repaid >= uint256(loan.defaultAfterMissed) * loan.installment) return true;
        return block.timestamp > uint256(activatedAt) + loan.maturity + loan.maturityGrace;
    }

    function triggerDefault() external {
        _notEnded();
        if (!defaultable()) revert NotDefaultable();
        _end(EndKind.Defaulted);
    }

    function _notEnded() internal view {
        if (ended != EndKind.None) revert Ended();
    }

    /// Freezes the vault and moves what the owner side still holds (opex, owner share, bond) to the lenders.
    function _end(EndKind kind) internal {
        ended = kind;
        uint256 sweep = opexBalance + ownerPending + bondHeld;
        opexBalance = 0;
        ownerPending = 0;
        bondHeld = 0;
        _toLenders(sweep);
        emit LoanEnded(uint8(kind));
    }

    /// Adds money to the lender pool outside the schedule: claimable pro rata, never counted in `repaid`.
    function _toLenders(uint256 amount) internal {
        if (amount == 0) return;
        swept += amount;
        lenderPool += amount;
        accPerShare += amount * ACC / raised;
    }
```

```solidity
    function _settle(uint256 id, Order storage o) internal {
        o.status = OrderStatus.Settled;
        escrowTotal -= o.price;
        if (ended != EndKind.None) {
            // After the end the whole price goes to the lenders.
            _toLenders(o.price);
            emit Settled(id, o.price, 0, 0);
            return;
        }
        (uint256 toLenders, uint256 toOwner, uint256 toOpex) = _split(o.price);
        emit Settled(id, toLenders, toOwner, toOpex);
    }

    function _refundKeepingCost(uint256 id, Order storage o) internal returns (uint256 refund, uint256 cost) {
        uint256 spent = supplierCost[id];
        cost = spent < o.price ? spent : o.price;
        refund = o.price - cost;
        escrowTotal -= o.price;
        if (ended != EndKind.None) _toLenders(cost);
        else opexBalance += cost;
        if (refund > 0) token.safeTransfer(o.buyer, refund);
    }
```

```solidity
    function applyOrder(PolicyOrder calldata o, bytes calldata sig) external {
        _notEnded();
        if (o.kind > uint8(Kind.Close)) revert UnknownKind();
        (bool registered,, bytes memory pubkey, bool proven) = PQC_KEYS.pqcKeyStatus(ownerPq);
        if (!registered || pubkey.length == 0) revert OwnerKeyNotRegistered();
        if (!proven) revert OwnerKeyNotProven();
        if (o.nonce != policyNonce) revert BadNonce();
        if (block.timestamp > o.expiry) revert OrderExpiredSig();
        if (!PQC_VERIFY.pqcVerify(pubkey, sig, signedBytes(o))) revert BadPqcSignature();
        if (_widens(Kind(o.kind)) && state() != State.Repaid) revert WideningLocked();
        policyNonce = o.nonce + 1;
        _apply(Kind(o.kind), o.target, o.value);
        emit PolicyApplied(o.nonce, o.kind, o.target, o.value);
    }

    function _widens(Kind k) internal pure returns (bool) {
        return k == Kind.AddSupplier || k == Kind.RaiseSupplierCap || k == Kind.RaiseDailyCap;
    }

    function _apply(Kind k, address target, uint256 value) internal {
        if (k == Kind.RemoveSupplier) {
            if (!suppliers[target].allowed) revert SupplierNotAllowed();
            delete suppliers[target];
        } else if (k == Kind.LowerSupplierCap) {
            Supplier storage s = suppliers[target];
            if (!s.allowed) revert SupplierNotAllowed();
            if (value == 0 || value >= s.perTxCap) revert NotNarrowing();
            s.perTxCap = value;
        } else if (k == Kind.LowerDailyCap) {
            if (value >= dailyCap) revert NotNarrowing();
            dailyCap = value;
        } else if (k == Kind.Pause) {
            if (paused) revert BadOrder();
            paused = true;
        } else if (k == Kind.Unpause) {
            if (!paused) revert BadOrder();
            paused = false;
        } else if (k == Kind.AddSupplier) {
            if (target == address(0) || value == 0 || suppliers[target].allowed) revert BadOrder();
            if (_isRole(target, spender, operator, ownerPq, ownerPayout)) revert BadOrder();
            suppliers[target] = Supplier(true, value);
        } else if (k == Kind.RaiseSupplierCap) {
            Supplier storage s = suppliers[target];
            if (!s.allowed) revert SupplierNotAllowed();
            if (value <= s.perTxCap) revert BadOrder();
            s.perTxCap = value;
        } else if (k == Kind.RaiseDailyCap) {
            if (value <= dailyCap) revert BadOrder();
            dailyCap = value;
        } else {
            // Close: only a running loan (Active or Trapped); Raising, Refunded and Repaid refuse.
            State s = state();
            if (s != State.Active && s != State.Trapped) revert WrongState();
            _end(EndKind.Closed);
        }
    }
```

- [ ] **Step 4: Run the tests and see them pass**

Run (in `sc/`): `forge test`
Expected: all suites pass, `LoanVaultDefaultTest` 13 tests.

- [ ] **Step 5: Commit**

```bash
git add sc/src/LoanVault.sol sc/test/LoanVault.Default.t.sol sc/test/LoanVault.Claims.t.sol sc/test/LoanVault.Policy.t.sol
git commit -m "feat(sc): default, Close and owner claim only when ahead" -m "Vault v2 (spec section 6, holes K2 and K3): anyone may trigger a default three installments behind or past maturity plus grace, the owner may sign a Close order, and both end the vault by sweeping opex, the owner share and the bond to lenders through the accumulator (not counted as repaid); open orders still finish, with the whole price going to lenders. The owner claims only one installment ahead or after repayment. Tests: forge test (all suites, new LoanVaultDefaultTest)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Contract: agent key rotation and self pause

**Files:**
- Modify: `sc/src/LoanVault.sol`
- Modify: `sc/test/LoanVault.Policy.t.sol`

**Interfaces:**
- Consumes: Task 4 `Kind`, `_apply`, `applyOrder`.
- Produces:
  - `address public spender; address public operator;` (storage, no longer immutable)
  - `Kind.RotateAgent` (= 9): `target` is the new spender, `value` is `uint256(uint160(newOperator))`; `event AgentRotated(address spender, address operator)`
  - `function selfPause() external` (spender or operator; `NotAgent` otherwise, `Paused` when already paused); `event AgentPaused(address indexed by)`; `error NotAgent();`
  - internal `_canBeAgent(address a) returns (bool)`

- [ ] **Step 1: Write the failing tests**

Append to `sc/test/LoanVault.Policy.t.sol` (inside the contract):

```solidity
    uint8 internal constant ROTATE_AGENT = 9;
    address internal newSpender = makeAddr("newSpender");
    address internal newOperator = makeAddr("newOperator");

    function _rotateOrder(address s, address o) internal view returns (LoanVault.PolicyOrder memory) {
        return _order(ROTATE_AGENT, s, uint256(uint160(o)));
    }

    function test_rotateAgentMovesBothRoles() public {
        vm.expectEmit(address(vault));
        emit LoanVault.AgentRotated(newSpender, newOperator);
        _apply(_rotateOrder(newSpender, newOperator));
        assertEq(vault.spender(), newSpender);
        assertEq(vault.operator(), newOperator);
        uint256 id = _buy(2);
        vm.prank(spender);
        vm.expectRevert(LoanVault.NotSpender.selector);
        vault.paySupplier(supplierA, 1e18, id);
        vm.prank(newSpender);
        vault.paySupplier(supplierA, 1e18, id);
        vm.prank(operator);
        vm.expectRevert(LoanVault.NotOperator.selector);
        vault.deliver(id, bytes32(0));
        vm.prank(newOperator);
        vault.deliver(id, bytes32(0));
    }

    function test_rotateAgentRefusesUnsafeAddresses() public {
        address[5] memory bad = [address(0), supplierA, ownerPq, ownerPayout, address(vault)];
        for (uint256 k; k < bad.length; k++) {
            LoanVault.PolicyOrder memory o = _rotateOrder(bad[k], newOperator);
            bytes memory sig = _sign(o);
            vm.expectRevert(LoanVault.BadOrder.selector);
            vault.applyOrder(o, sig);
            o = _rotateOrder(newSpender, bad[k]);
            sig = _sign(o);
            vm.expectRevert(LoanVault.BadOrder.selector);
            vault.applyOrder(o, sig);
        }
        assertEq(vault.policyNonce(), 0);
    }

    function test_rotateAgentRefusesValueAbove160Bits() public {
        LoanVault.PolicyOrder memory o = _order(ROTATE_AGENT, newSpender, (uint256(1) << 160) | uint256(uint160(newOperator)));
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.BadOrder.selector);
        vault.applyOrder(o, sig);
    }

    function test_rotateAgentByNonOwnerRefused() public {
        LoanVault.PolicyOrder memory o = _rotateOrder(newSpender, newOperator);
        vm.expectRevert(LoanVault.BadPqcSignature.selector);
        vault.applyOrder(o, hex"deadbeef");
        assertEq(vault.spender(), spender);
    }

    function test_rotateAgentAllowedWhileRaising() public {
        vault = _create(_init());
        _apply(_rotateOrder(newSpender, newOperator));
        assertEq(vault.spender(), newSpender);
    }

    function test_agentCanPauseButNotUnpause() public {
        vm.expectEmit(address(vault));
        emit LoanVault.AgentPaused(spender);
        vm.prank(spender);
        vault.selfPause();
        assertTrue(vault.paused());
        vm.prank(operator);
        vm.expectRevert(LoanVault.Paused.selector);
        vault.selfPause();
        _apply(_order(UNPAUSE, address(0), 0));
        assertFalse(vault.paused());
        vm.prank(operator);
        vault.selfPause();
        assertTrue(vault.paused());
    }

    function test_onlyTheAgentSelfPauses() public {
        address[3] memory others = [ownerPq, buyer, stranger];
        for (uint256 k; k < others.length; k++) {
            vm.prank(others[k]);
            vm.expectRevert(LoanVault.NotAgent.selector);
            vault.selfPause();
        }
    }
```

In `test_unknownKindReverts` use `_order(10, address(0), 0)`.

- [ ] **Step 2: Run the tests and see them fail**

Run (in `sc/`): `forge test --match-contract LoanVaultPolicyTest`
Expected: compilation fails with `Member "selfPause" not found` and `Member "AgentRotated" not found`.

- [ ] **Step 3: Implement**

In `sc/src/LoanVault.sol`: append `RotateAgent` to `Kind`; change the two role declarations to

```solidity
    /// The agent keys; the owner may rotate them with a signed RotateAgent order.
    address public spender;
    address public operator;
```

add `event AgentRotated(address spender, address operator);`, `event AgentPaused(address indexed by);` and `error NotAgent();`; in `applyOrder` use `if (o.kind > uint8(Kind.RotateAgent)) revert UnknownKind();`; in `_apply` replace the final `else` block with:

```solidity
        } else if (k == Kind.Close) {
            // Only a running loan (Active or Trapped); Raising, Refunded and Repaid refuse.
            State s = state();
            if (s != State.Active && s != State.Trapped) revert WrongState();
            _end(EndKind.Closed);
        } else {
            // RotateAgent: target = new spender, value = new operator as uint256(uint160(addr)).
            address newOperator = address(uint160(value));
            if (value >> 160 != 0 || target == address(0) || newOperator == address(0)) revert BadOrder();
            if (!_canBeAgent(target) || !_canBeAgent(newOperator)) revert BadOrder();
            spender = target;
            operator = newOperator;
            emit AgentRotated(target, newOperator);
        }
```

and add:

```solidity
    /// The agent may stop its own vault (a leaked key is noticed first by the agent); only the owner resumes it.
    function selfPause() external {
        if (msg.sender != spender && msg.sender != operator) revert NotAgent();
        if (paused) revert Paused();
        paused = true;
        emit AgentPaused(msg.sender);
    }

    /// An agent key may not be a supplier or an owner address, so no role can pay itself.
    function _canBeAgent(address a) internal view returns (bool) {
        return !suppliers[a].allowed && a != ownerPq && a != ownerPayout && a != address(this);
    }
```

- [ ] **Step 4: Run the tests and see them pass**

Run (in `sc/`): `forge test`
Expected: all suites pass, `LoanVaultPolicyTest` with the seven new tests.

- [ ] **Step 5: Commit**

```bash
git add sc/src/LoanVault.sol sc/test/LoanVault.Policy.t.sol
git commit -m "feat(sc): rotate agent keys and let the agent pause itself" -m "Vault v2 (spec section 7, hole K5): spender and operator become storage, a signed RotateAgent order replaces both (never a supplier, an owner address or the vault), and either agent key may pause the vault while only the owner resumes it. Tests: forge test (all suites)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Contract: invariant handler and fuzz tests for v2

**Files:**
- Modify: `sc/test/LoanVault.Invariant.t.sol`, `sc/test/LoanVault.Fuzz.t.sol`

**Interfaces:**
- Consumes: the v2 vault of Tasks 1 to 5.
- Produces: `VaultHandler` with `buy`, `buyAndDeliver`, `deliver`, `accept`, `settle`, `reject`, `decline`, `reclaim`, `pay`, `claimLender`, `claimOwner`, `triggerDefault`, `close`, `warp`; invariants `booksEqualBalance`, `repaidNeverExceedsOwed`, `lenderClaimsCovered`, `ownerNeverGetsMoreThanItsShare`, `supplierCostNeverAboveThePrice`, `endedVaultHoldsNoOwnerMoney`; fuzz `testFuzz_supplierSpendNeverExceedsOrderPrice`, `testFuzz_rejectReturnsPriceLessCost`.

- [ ] **Step 1: Write the tests**

Replace `sc/test/LoanVault.Invariant.t.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {MockToken} from "./mocks/MockToken.sol";

contract VaultHandler is Test {
    LoanVault internal vault;
    MockToken internal fusd;
    address internal spender;
    address internal operator;
    address internal buyer;
    address internal supplier;
    address[2] internal lenders;

    // Ghost counters, incremented only on success
    uint256 public buys;
    uint256 public deliveries;
    uint256 public settlements;
    uint256 public rejections;
    uint256 public ends;
    uint256 public lenderClaims;
    uint256 public supplierPayments;
    uint256 public ownerEntitledMax; // sum over settlements of price * ownerBps / 10000

    constructor(LoanVault v, MockToken t, address s, address o, address b, address sup, address la, address lb) {
        (vault, fusd, spender, operator, buyer, supplier) = (v, t, s, o, b, sup);
        lenders = [la, lb];
    }

    function _id(uint256 seed) internal view returns (uint256) {
        return bound(seed, 1, vault.orderCount());
    }

    function _price(uint256 id) internal view returns (uint256 price) {
        (,,,, price,,) = vault.orders(id);
    }

    function buy(uint256 serviceId) external {
        serviceId = bound(serviceId, 0, 2);
        vm.prank(buyer);
        try vault.buy(serviceId, bytes32(serviceId)) {
            buys++;
        } catch {}
    }

    function buyAndDeliver(uint256 serviceId) external {
        serviceId = bound(serviceId, 0, 2);
        vm.prank(buyer);
        try vault.buy(serviceId, bytes32(serviceId)) returns (uint256 id) {
            buys++;
            _deliver(id);
        } catch {}
    }

    function _deliver(uint256 id) internal {
        vm.prank(operator);
        try vault.deliver(id, bytes32(id)) {
            deliveries++;
        } catch {}
    }

    function deliver(uint256 id) external {
        if (vault.orderCount() == 0) return;
        _deliver(_id(id));
    }

    function accept(uint256 id) external {
        if (vault.orderCount() == 0) return;
        id = _id(id);
        uint256 price = _price(id);
        vm.prank(buyer);
        try vault.accept(id) {
            settlements++;
            ownerEntitledMax += price * vault.ownerBps() / 10_000;
        } catch {}
    }

    function settle(uint256 id) external {
        if (vault.orderCount() == 0) return;
        id = _id(id);
        uint256 price = _price(id);
        try vault.settle(id) {
            settlements++;
            ownerEntitledMax += price * vault.ownerBps() / 10_000;
        } catch {}
    }

    function reject(uint256 id) external {
        if (vault.orderCount() == 0) return;
        vm.prank(buyer);
        try vault.reject(_id(id)) {
            rejections++;
        } catch {}
    }

    function decline(uint256 id) external {
        if (vault.orderCount() == 0) return;
        vm.prank(operator);
        try vault.decline(_id(id), 0) {} catch {}
    }

    function reclaim(uint256 id) external {
        if (vault.orderCount() == 0) return;
        vm.prank(buyer);
        try vault.reclaim(_id(id)) {} catch {}
    }

    function pay(uint256 amount, uint256 id) external {
        if (vault.orderCount() == 0) return;
        amount = bound(amount, 1, 10e18);
        vm.prank(spender);
        try vault.paySupplier(supplier, amount, _id(id)) {
            supplierPayments++;
        } catch {}
    }

    function claimLender(uint256 who) external {
        vm.prank(lenders[who % 2]);
        try vault.claimLender() {
            lenderClaims++;
        } catch {}
    }

    function claimOwner() external {
        try vault.claimOwner() {} catch {}
    }

    /// Ends only after some business happened, so the run never ends empty (see afterInvariant).
    function triggerDefault() external {
        if (deliveries == 0) return;
        try vault.triggerDefault() {
            ends++;
        } catch {}
    }

    function close() external {
        if (deliveries == 0) return;
        LoanVault.PolicyOrder memory o = LoanVault.PolicyOrder({
            kind: 8, target: address(0), value: 0, nonce: vault.policyNonce(), expiry: uint64(block.timestamp + 1 hours)
        });
        bytes memory sig = abi.encodePacked(keccak256(abi.encodePacked("ok", hex"c0ffee", vault.signedBytes(o))));
        try vault.applyOrder(o, sig) {
            ends++;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }
}

/// forge-config: default.invariant.depth = 128
contract LoanVaultInvariantTest is Base {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        _activate();
        handler = new VaultHandler(vault, fusd, spender, operator, buyer, supplierA, lenderA, lenderB);
        targetContract(address(handler));
    }

    function invariant_booksEqualBalance() public view {
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function invariant_repaidNeverExceedsOwed() public view {
        assertLe(vault.repaid(), OWED);
    }

    function invariant_lenderClaimsCovered() public view {
        assertGe(vault.lenderPool(), vault.lenderClaimable(lenderA) + vault.lenderClaimable(lenderB));
    }

    function invariant_ownerNeverGetsMoreThanItsShare() public view {
        assertLe(vault.ownerPending() + fusd.balanceOf(ownerPayout), handler.ownerEntitledMax());
    }

    function invariant_supplierCostNeverAboveThePrice() public view {
        uint256 n = vault.orderCount();
        for (uint256 id = 1; id <= n; id++) {
            (,,,, uint256 price,,) = vault.orders(id);
            assertLe(vault.supplierCost(id), price);
        }
    }

    function invariant_endedVaultHoldsNoOwnerMoney() public view {
        if (vault.ended() == LoanVault.EndKind.None) return;
        assertEq(vault.ownerPending(), 0);
        assertEq(vault.opexBalance(), 0);
        assertEq(vault.bondHeld(), 0);
    }

    /// The run must have exercised the vault; a handler that only reverts would pass the rest vacuously.
    function afterInvariant() public view {
        assertGt(handler.buys(), 0, "no successful buy");
        assertGt(handler.deliveries(), 0, "no successful delivery");
    }
}
```

Append to `sc/test/LoanVault.Fuzz.t.sol` (inside the contract):

```solidity
    function testFuzz_supplierSpendNeverExceedsOrderPrice(uint256[8] memory amounts, uint8[8] memory picks) public {
        _activate();
        uint256[3] memory ids = [_buy(0), _buy(1), _buy(2)];
        uint256 t = block.timestamp;
        for (uint256 k; k < 8; k++) {
            uint256 id = ids[picks[k] % 3];
            uint256 amount = bound(amounts[k], 1, CAP_A);
            t += 1 days; // a new day each time, so the daily cap never decides
            vm.warp(t);
            vm.prank(spender);
            try vault.paySupplier(supplierA, amount, id) {} catch {}
            for (uint256 j; j < 3; j++) {
                (,,,, uint256 price,,) = vault.orders(ids[j]);
                assertLe(vault.supplierCost(ids[j]), price, "spend on an order above its price");
            }
        }
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function testFuzz_rejectReturnsPriceLessCost(uint256 spend) public {
        _activate();
        uint256 id = _buy(1); // 5 fUSD
        spend = bound(spend, 0, PRICE1);
        if (spend > 0) {
            vm.prank(spender);
            vault.paySupplier(supplierA, spend, id);
        }
        _deliver(id);
        uint256 before = fusd.balanceOf(buyer);
        uint256 opex = vault.opexBalance();
        vm.prank(buyer);
        vault.reject(id);
        assertEq(fusd.balanceOf(buyer) - before, PRICE1 - spend);
        assertEq(vault.opexBalance() - opex, spend);
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }
```

- [ ] **Step 2: Run the tests**

Run (in `sc/`): `forge test --match-contract "LoanVaultInvariantTest|LoanVaultFuzzTest" -vv`
Expected: pass. These tests cover code written in Tasks 1 to 5, so they are expected to pass on the first run; if one fails, it is a contract bug: stop, report the counterexample (`forge` prints the call sequence) and follow superpowers:systematic-debugging before changing the contract.

- [ ] **Step 3: Run the whole suite**

Run (in `sc/`): `forge test`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add sc/test/LoanVault.Invariant.t.sol sc/test/LoanVault.Fuzz.t.sol
git commit -m "test(sc): invariants and fuzz for the v2 vault" -m "Spec section 12: the handler now also accepts, settles, rejects, defaults and closes; invariants check the books with bondHeld, repaid <= totalOwed, lender claims within the pool, the owner never above its share, supplier spend per order within the price, and an ended vault holding no owner money. Two fuzz tests cover spend per order and the rejection refund. Tests: forge test (all suites)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Deploy the v2 factory on the testnet

**Files:**
- Modify: `sc/README.md`

**Interfaces:**
- Consumes: `sc/script/DeployFactory.s.sol` (Task 1), `engine/spikes/src/window.ts` (existing), the deployer key `sc/.deployer.key` and spike account `deployer` (gitignored).
- Produces: the v2 factory address `FACTORY_V2` and its deploy block `FACTORY_V2_BLOCK` (decimal), recorded in `sc/README.md`, used by Task 8.

- [ ] **Step 1: Check the build that will be deployed**

Run (in `sc/`): `forge build && forge test`
Expected: `Compiler run successful` and all suites pass.

- [ ] **Step 2: STOP: ask the human**

Ask: "Ready to deploy the v2 VaultFactory to qorechain-diana from the deployer account. This opens an unscoped EVM window and spends testnet QOR. Go ahead?" Wait for a yes. Do not run Steps 3 and 4 without it.

- [ ] **Step 3: Open the deployer window and deploy**

Run (in `engine/spikes/`): `bun src/window.ts open deployer 1200 4 40000000`
Expected: `window opened <hash> (1200 blocks, 4 txs, 40000000 uqor, targets: any)`.
Run (in `sc/`): `PRIVATE_KEY=$(cat .deployer.key) forge script script/DeployFactory.s.sol --rpc-url qorechain_testnet --broadcast`
Expected: `VaultFactory 0x…` and `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`. Note the address (`FACTORY_V2`), the transaction hash and the block from `sc/broadcast/DeployFactory.s.sol/9800/run-latest.json` (`receipts[0].blockNumber`, hex; convert to decimal for `FACTORY_V2_BLOCK`).

- [ ] **Step 4: Verify read-only**

Run: `cast call <FACTORY_V2> "token()(address)" --rpc-url https://evm-testnet.qore.host`
Expected: `0x97143B771D34ddb9130b807b135Ae675A5a963CA`.
Run: `cast call <FACTORY_V2> "count()(uint256)" --rpc-url https://evm-testnet.qore.host`
Expected: `0`.

- [ ] **Step 5: Record**

In `sc/README.md` replace the contract list and the table with:

```markdown
- `src/LoanVault.sol`: one vault per agent business (v2): lender capital, the owner's bond (10 % of the target), order escrow with a 24 h buyer review, supplier payments under caps and within each order's price, the revenue split (lenders first), default and Close (the owner side is swept to lenders), agent key rotation and ML-DSA-87-signed policy orders (narrowing only while a loan runs).
- `src/VaultFactory.sol`: deploys and lists vaults in fUSD and pulls the bond from the creator.
- `src/spike/SenderProbe.sol`: used only by the spikes.

## Deployed on qorechain-diana

| Contract | Address | Tx |
|---|---|---|
| VaultFactory v2 | `<FACTORY_V2>` | `<deploy tx>` (block <FACTORY_V2_BLOCK>) |
| VaultFactory v1 (kept, no longer listed by the app) | `0xAc5324088A7735dda922c277db5A2E906c8f5b3A` | `0x11a99af52774dca850678ffd9c344012339aa7c19e11f88b60571676d70bd2af` |
| Smoke vault v1 (script signer) | `0xF8100c2E87a61Fe201f9e43B6dF18db7DB15fC2f` | `0xc3bb7f758d81bae435861d3b46c0a8bcb17df479f6af38088321c8d97710c5fb` |
| Smoke vault v1 (QoreX signer) | `0x0E343bF008E78630BD1dbb2Ff4F2DD5FB0F7B64f` | create: see RESULTS.md; applyOrder: `0x2b1f52d113178190c2cd7ae6c1e0baf09738180357c8107ef5a0e5ef0dc720ca` |

The v2 smoke run (deploy, raise, buy, deliver, accept, settle, reject, trigger default) is recorded in `engine/RESULTS.md`.
```

- [ ] **Step 6: Commit**

```bash
git add sc/README.md
git commit -m "docs(sc): record the v2 factory on qorechain-diana" -m "The v2 VaultFactory is deployed in fUSD next to the untouched v1 factory. Evidence: deploy tx <deploy tx>, token() and count() read back with cast call." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: `packages/qore`: v2 ABI, frozen v1 ABI, addresses, states and statuses

**Files:**
- Create: `packages/qore/src/generated/abis-v1.ts`, `packages/qore/scripts/immutables.ts`, `packages/qore/test/immutables.test.ts`, `packages/qore/test/v2.test.ts`
- Modify: `packages/qore/scripts/export-abi.ts`, `packages/qore/src/abi.ts`, `packages/qore/package.json`, `packages/qore/test/abi.test.ts`, `packages/qore/test/generated.test.ts`
- Regenerate: `packages/qore/src/generated/abis.ts`
- Modify (compile fixes forced by the new ABI, behaviour unchanged): `engine/businesses.json`, `engine/src/setup/businesses.ts`, `engine/test/businesses.test.ts`, `engine/test/chain.test.ts`, `apps/be/src/services/watcher.ts`, `apps/fe/src/components/shared/vaultErrors.ts`, `apps/fe/src/modules/inbox/api/inbox.api.ts`

**Interfaces:**
- Consumes: `sc/out` from `forge build` (Task 6 contract), `FACTORY_V2` and `FACTORY_V2_BLOCK` from Task 7.
- Produces (all exported from `@qredit/qore` and its light subpath `@qredit/qore/abi`, except the generated ones):
  - `FACTORY_ADDRESS` (v2), `FACTORY_START_BLOCK` (v2), `FACTORY_V1_ADDRESS`, `FACTORY_V1_START_BLOCK`
  - `type VaultVersion = 1 | 2`
  - `BOND_BPS = 1000n`, `REVIEW_WINDOW_SECONDS = 86_400`, `bondFor(target: bigint): bigint`
  - `VAULT_EVENTS` (v2: `OrderPlaced`, `Delivered`, `Settled`, `Rejected`, `Declined`, `Reclaimed`, `LoanEnded`, `AgentRotated`), `VAULT_EVENTS_V1` (v1: `OrderPlaced`, `Delivered` with the split, `Declined`, `Reclaimed`)
  - `VAULT_ABI` and `FACTORY_ABI` (human-readable, v2 `Init` without `token`)
  - `VAULT_STATE = { Raising: 0, Active: 1, Trapped: 2, Repaid: 3, Refunded: 4, Defaulted: 5, Closed: 6 }`
  - `ORDER_STATUS = { None: 0, Open: 1, InReview: 2, Settled: 3, Rejected: 4, Declined: 5, Reclaimed: 6 }`
  - generated: `LOAN_VAULT_ABI`, `VAULT_FACTORY_ABI`, `FACTORY_RUNTIME_CODEHASH` (`@qredit/qore/abis`), `LOAN_VAULT_V1_ABI` (`@qredit/qore/abis-v1`)
  - `fillImmutables(code: Hex, refs: ImmutableRefs, value: Hex): Hex` (scripts only)

- [ ] **Step 1: Freeze the v1 ABI before regenerating**

Run (in `packages/qore/`, while `src/generated/abis.ts` is still the v1 file):

```bash
bun -e 'const fs=require("fs");const s=fs.readFileSync("src/generated/abis.ts","utf8");const a=s.indexOf("export const LOAN_VAULT_ABI");const b=s.indexOf("export const VAULT_FACTORY_ABI");if(a<0||b<0)throw new Error("unexpected layout");fs.writeFileSync("src/generated/abis-v1.ts","// Frozen copy of the v1 LoanVault ABI, taken from src/generated/abis.ts before vault v2. Never regenerate: v1 vaults stay on chain.\n"+s.slice(a,b).replace("export const LOAN_VAULT_ABI","export const LOAN_VAULT_V1_ABI"))'
```

Expected: `src/generated/abis-v1.ts` exists and `grep -c "toLenders" src/generated/abis-v1.ts` prints at least `1` (the v1 `Delivered` event).

Add `"./abis-v1": "./src/generated/abis-v1.ts",` after `"./abis"` in `packages/qore/package.json` `exports`.

- [ ] **Step 2: Write the failing tests**

Create `packages/qore/test/immutables.test.ts`:

```ts
import { expect, test } from "bun:test";
import { fillImmutables } from "../scripts/immutables.ts";

const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";

test("writes the padded value into every immutable slot", () => {
  const code = `0x${"00".repeat(70)}` as const;
  const out = fillImmutables(code, { "1": [{ start: 2, length: 32 }], "2": [{ start: 36, length: 32 }] }, FUSD);
  const word = `${"00".repeat(12)}${FUSD.slice(2).toLowerCase()}`;
  expect(out.slice(2 + 4, 2 + 4 + 64)).toBe(word);
  expect(out.slice(2 + 72, 2 + 72 + 64)).toBe(word);
  expect(out.length).toBe(2 + 140);
});

test("refuses a slot that is not one word or runs past the code", () => {
  expect(() => fillImmutables("0x0000", { "1": [{ start: 0, length: 20 }] }, FUSD)).toThrow("bad immutable slot");
  expect(() => fillImmutables("0x0000", { "1": [{ start: 0, length: 32 }] }, FUSD)).toThrow("bad immutable slot");
});
```

Create `packages/qore/test/v2.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { encodeFunctionData, getAbiItem } from "viem";
import {
  BOND_BPS, bondFor, FACTORY_ABI, FACTORY_ADDRESS, FACTORY_V1_ADDRESS, LOAN_VAULT_ABI, ORDER_STATUS, REVIEW_WINDOW_SECONDS,
  VAULT_ABI, VAULT_EVENTS, VAULT_EVENTS_V1, VAULT_STATE,
} from "../src/index.ts";
import { LOAN_VAULT_V1_ABI } from "../src/generated/abis-v1.ts";

const names = (abi: readonly { type: string; name?: string }[], type: string) => abi.filter((x) => x.type === type).map((x) => x.name);

describe("vault v2 constants", () => {
  test("the bond is 10 % of the target", () => {
    expect(BOND_BPS).toBe(1000n);
    expect(bondFor(50_000_000n)).toBe(5_000_000n);
    expect(bondFor(9n)).toBe(0n);
  });
  test("review window, states and order statuses follow the contract", () => {
    expect(REVIEW_WINDOW_SECONDS).toBe(86_400);
    expect(VAULT_STATE).toEqual({ Raising: 0, Active: 1, Trapped: 2, Repaid: 3, Refunded: 4, Defaulted: 5, Closed: 6 });
    expect(ORDER_STATUS).toEqual({ None: 0, Open: 1, InReview: 2, Settled: 3, Rejected: 4, Declined: 5, Reclaimed: 6 });
  });
  test("v1 and v2 factories differ", () => {
    expect(FACTORY_ADDRESS.toLowerCase()).not.toBe(FACTORY_V1_ADDRESS.toLowerCase());
  });
});

describe("events", () => {
  test("v2 events carry the review and the ending", () => {
    expect(names(VAULT_EVENTS, "event")).toEqual(["OrderPlaced", "Delivered", "Settled", "Rejected", "Declined", "Reclaimed", "LoanEnded", "AgentRotated"]);
    expect(getAbiItem({ abi: VAULT_EVENTS, name: "Delivered" }).inputs.map((i) => i.name)).toEqual(["orderId", "envelopeHash", "reviewEnds"]);
  });
  test("v1 events keep the split on Delivered", () => {
    expect(getAbiItem({ abi: VAULT_EVENTS_V1, name: "Delivered" }).inputs.map((i) => i.name)).toEqual(["orderId", "envelopeHash", "toLenders", "toOwner", "toOpex"]);
  });
});

describe("generated ABIs", () => {
  test("v2 vault has the new functions, errors and events", () => {
    const fns = names(LOAN_VAULT_ABI, "function");
    for (const f of ["accept", "settle", "reject", "triggerDefault", "defaultable", "selfPause", "withdrawBond", "bondHeld", "swept", "ended", "uniqueBuyers", "seenBuyer", "supplierCost", "REVIEW_WINDOW", "BOND_BPS"]) {
      expect(fns).toContain(f);
    }
    const errors = names(LOAN_VAULT_ABI, "error");
    for (const e of ["Ended", "OverOrderPrice", "NotInReview", "ReviewOpen", "ReviewOver", "OwnerClaimNotAhead", "NotDefaultable", "BuyerNotAllowed", "NotAgent"]) {
      expect(errors).toContain(e);
    }
    expect(errors).not.toContain("TrappedNoOwnerClaim");
    expect(names(LOAN_VAULT_ABI, "event")).toEqual(expect.arrayContaining(["Settled", "Rejected", "LoanEnded", "AgentRotated", "AgentPaused", "BondReturned"]));
  });
  test("v1 vault ABI is the frozen one", () => {
    expect(names(LOAN_VAULT_V1_ABI, "function")).not.toContain("accept");
    expect(names(LOAN_VAULT_V1_ABI, "error")).toContain("TrappedNoOwnerClaim");
  });
  test("human-readable ABIs encode v2 calls", () => {
    expect(encodeFunctionData({ abi: VAULT_ABI, functionName: "settle", args: [7n] }).length).toBe(2 + 8 + 64);
    expect(names(FACTORY_ABI, "function")).toContain("token");
  });
});
```

In `packages/qore/test/abi.test.ts` replace the `factory create encodes an Init tuple` test with:

```ts
  test("factory create encodes a v2 Init tuple (no token, maturity terms)", () => {
    const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: "create", args: [{
      spender: "0x0000000000000000000000000000000000000001", operator: "0x0000000000000000000000000000000000000002",
      ownerPq: "0x0000000000000000000000000000000000000003", ownerPayout: "0x0000000000000000000000000000000000000003", cosmosChainId: "qorechain-diana",
      lenderBps: 3000, ownerBps: 2000, dailyCap: 1n, orderTtl: 3600n,
      loan: { target: 10n, totalOwed: 10n, raiseDeadline: 2n, period: 1n, grace: 0n, installment: 10n, maturity: 1n, maturityGrace: 0n, defaultAfterMissed: 3 },
      suppliers: [], supplierCaps: [], servicePrices: [1n],
    }] });
    expect(data.startsWith("0x")).toBe(true);
  });
```

In `packages/qore/test/generated.test.ts` add `"bondHeld", "supplierCost", "uniqueBuyers"` to the list of reads in the first test and add to the second test `expect(names(VAULT_FACTORY_ABI, "function")).toContain("token");`.

- [ ] **Step 3: Run the tests and see them fail**

Run (in `packages/qore/`): `bun test`
Expected: failures, for example `Cannot find module '../scripts/immutables.ts'` and `Export named 'bondFor' not found`.

- [ ] **Step 4: Implement**

Create `packages/qore/scripts/immutables.ts`:

```ts
import { bytesToHex, hexToBytes, pad, type Hex } from "viem";

/** Forge's `deployedBytecode.immutableReferences`: for each immutable, where its 32-byte word sits in the runtime code. */
export type ImmutableRefs = Record<string, { start: number; length: number }[]>;

/** Writes `value` (left-padded to 32 bytes) into every immutable slot, as the EVM does when the contract is deployed. */
export function fillImmutables(code: Hex, refs: ImmutableRefs, value: Hex): Hex {
  const bytes = hexToBytes(code);
  const word = hexToBytes(pad(value, { size: 32 }));
  for (const slots of Object.values(refs)) {
    for (const { start, length } of slots) {
      if (length !== 32 || start + 32 > bytes.length) throw new Error(`bad immutable slot at ${start} (${length} bytes)`);
      bytes.set(word, start);
    }
  }
  return bytesToHex(bytes);
}
```

Replace `packages/qore/scripts/export-abi.ts` with:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, type Hex } from "viem";
import { FUSD_ADDRESS } from "../src/abi.ts";
import { fillImmutables, type ImmutableRefs } from "./immutables.ts";

const root = join(import.meta.dir, "..", "..", "..");
const artifact = (name: string) =>
  JSON.parse(readFileSync(join(root, "sc", "out", `${name}.sol`, `${name}.json`), "utf8")) as {
    abi: unknown[];
    deployedBytecode: { object: Hex; immutableReferences?: ImmutableRefs };
  };

const vault = artifact("LoanVault");
const factory = artifact("VaultFactory");
const refs = factory.deployedBytecode.immutableReferences ?? {};
// The v2 factory has exactly one immutable, its token; the deployed code holds fUSD there.
if (Object.keys(refs).length !== 1) throw new Error(`VaultFactory should have one immutable (token), found ${Object.keys(refs).length}`);
const runtime = fillImmutables(factory.deployedBytecode.object, refs, FUSD_ADDRESS);

const out = join(import.meta.dir, "..", "src", "generated");
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "abis.ts"),
  [
    "// Generated by packages/qore/scripts/export-abi.ts from sc/out. Do not edit; run `bun run export-abi` after `forge build`.",
    `export const LOAN_VAULT_ABI = ${JSON.stringify(vault.abi, null, 2)} as const;`,
    `export const VAULT_FACTORY_ABI = ${JSON.stringify(factory.abi, null, 2)} as const;`,
    "/** keccak256 of VaultFactory's runtime bytecode with its immutable token set to fUSD, which equals the deployed code. */",
    `export const FACTORY_RUNTIME_CODEHASH = "${keccak256(runtime)}" as const;`,
    "",
  ].join("\n"),
);
console.log("wrote src/generated/abis.ts");
```

Replace `packages/qore/src/abi.ts` with (put the Task 7 values in place of `<FACTORY_V2>` and `<FACTORY_V2_BLOCK>`):

```ts
import { parseAbi, toFunctionSelector } from "viem";

/** The v2 factory (vault v2 spec): fixed fUSD token and the owner's bond. Deploy tx and block: sc/README.md. */
export const FACTORY_ADDRESS = "<FACTORY_V2>" as const;
/** Block of the v2 factory deployment; no v2 factory log can exist before it. */
export const FACTORY_START_BLOCK = <FACTORY_V2_BLOCK>;
/** The v1 factory and its vaults stay on chain untouched; apps read them only for old orders and positions. */
export const FACTORY_V1_ADDRESS = "0xAc5324088A7735dda922c277db5A2E906c8f5b3A" as const;
/** Block of the v1 factory deployment tx 0x11a99af52774dca850678ffd9c344012339aa7c19e11f88b60571676d70bd2af. */
export const FACTORY_V1_START_BLOCK = 10_667_776;
export const FUSD_ADDRESS = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
export const FUSD_DENOM = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";

/** Which LoanVault build a vault runs. The backend stores it per business. */
export type VaultVersion = 1 | 2;

/** LoanVault.BOND_BPS: the owner's bond in basis points of the loan target. */
export const BOND_BPS = 1000n;
/** LoanVault.REVIEW_WINDOW: how long a buyer may reject a delivered report, in seconds. */
export const REVIEW_WINDOW_SECONDS = 86_400;
/** The bond the v2 factory pulls from the creator for a loan target (fUSD units). */
export const bondFor = (target: bigint): bigint => (target * BOND_BPS) / 10_000n;

/** The events of a v2 vault that the apps read. */
export const VAULT_EVENTS = parseAbi([
  "event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline)",
  "event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 reviewEnds)",
  "event Settled(uint256 indexed orderId, uint256 toLenders, uint256 toOwner, uint256 toOpex)",
  "event Rejected(uint256 indexed orderId, uint256 refund, uint256 cost)",
  "event Declined(uint256 indexed orderId, uint8 reasonCode)",
  "event Reclaimed(uint256 indexed orderId)",
  "event LoanEnded(uint8 kind)",
  "event AgentRotated(address spender, address operator)",
]);

/** The order events of a v1 vault: Delivered still carries the split. */
export const VAULT_EVENTS_V1 = parseAbi([
  "event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline)",
  "event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 toLenders, uint256 toOwner, uint256 toOpex)",
  "event Declined(uint256 indexed orderId, uint8 reasonCode)",
  "event Reclaimed(uint256 indexed orderId)",
]);

export const SUPPLIER_PAID_EVENT = parseAbi(["event SupplierPaid(address indexed supplier, uint256 amount, uint256 indexed orderId)"]);

export const VAULT_ABI = parseAbi([
  "struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; uint64 maturity; uint64 maturityGrace; uint16 defaultAfterMissed; }",
  "struct Init { address spender; address operator; address ownerPq; address ownerPayout; string cosmosChainId; uint16 lenderBps; uint16 ownerBps; uint256 dailyCap; uint64 orderTtl; LoanTerms loan; address[] suppliers; uint256[] supplierCaps; uint256[] servicePrices; }",
  "function deposit(uint256 amount)",
  "function buy(uint256 serviceId, bytes32 requestRef) returns (uint256)",
  "function deliver(uint256 orderId, bytes32 envelopeHash)",
  "function decline(uint256 orderId, uint8 reasonCode)",
  "function accept(uint256 orderId)",
  "function settle(uint256 orderId)",
  "function reject(uint256 orderId)",
  "function triggerDefault()",
  "function paySupplier(address supplier, uint256 amount, uint256 orderId)",
  "function claimLender()",
  "function state() view returns (uint8)",
  "function defaultable() view returns (bool)",
  "function raised() view returns (uint256)",
  "function repaid() view returns (uint256)",
  "function opexBalance() view returns (uint256)",
  "function bondHeld() view returns (uint256)",
  "function swept() view returns (uint256)",
  "function loan() view returns (uint256 target, uint256 totalOwed, uint64 raiseDeadline, uint64 period, uint64 grace, uint256 installment, uint64 maturity, uint64 maturityGrace, uint16 defaultAfterMissed)",
  "function orders(uint256 orderId) view returns (address buyer, uint32 serviceId, uint64 deadline, uint8 status, uint256 price, bytes32 requestRef, uint64 reviewEnds)",
  "function supplierCost(uint256 orderId) view returns (uint256)",
  "function servicePrice(uint256 serviceId) view returns (uint256)",
  "function serviceCount() view returns (uint256)",
  "function spender() view returns (address)",
  "function operator() view returns (address)",
  "function ownerPq() view returns (address)",
  "function paused() view returns (bool)",
  "function dailyCap() view returns (uint256)",
  "function spentToday() view returns (uint256)",
  "function dayIndex() view returns (uint64)",
  "function suppliers(address) view returns (bool allowed, uint256 perTxCap)",
  "error OrderNotOpen()",
  "error OrderExpired()",
  "error NotOperator()",
  "error NotInReview()",
  "error ReviewOpen()",
]);

export const FACTORY_ABI = parseAbi([
  "struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; uint64 maturity; uint64 maturityGrace; uint16 defaultAfterMissed; }",
  "struct Init { address spender; address operator; address ownerPq; address ownerPayout; string cosmosChainId; uint16 lenderBps; uint16 ownerBps; uint256 dailyCap; uint64 orderTtl; LoanTerms loan; address[] suppliers; uint256[] supplierCaps; uint256[] servicePrices; }",
  "function create(Init init) returns (address)",
  "function count() view returns (uint256)",
  "function token() view returns (address)",
  "event VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index)",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const PAY_SUPPLIER_SELECTOR = toFunctionSelector("paySupplier(address,uint256,uint256)");

/** LoanVault.State, in declaration order. Defaulted and Closed exist only in v2 vaults. */
export const VAULT_STATE = { Raising: 0, Active: 1, Trapped: 2, Repaid: 3, Refunded: 4, Defaulted: 5, Closed: 6 } as const;

/** LoanVault.OrderStatus of a v2 vault, in declaration order. */
export const ORDER_STATUS = { None: 0, Open: 1, InReview: 2, Settled: 3, Rejected: 4, Declined: 5, Reclaimed: 6 } as const;
```

Regenerate (in `sc/` then `packages/qore/`): `forge build` and `bun run export-abi`
Expected: `wrote src/generated/abis.ts`.

Compile fixes forced by the new ABI in the same commit (behaviour unchanged):
- `apps/be/src/services/watcher.ts`: import and use `VAULT_EVENTS_V1` instead of `VAULT_EVENTS` (every registered vault is still v1; Task 11 decodes per version).
- `apps/fe/src/modules/inbox/api/inbox.api.ts`: `const DELIVERED = getAbiItem({ abi: VAULT_EVENTS_V1, name: "Delivered" });` with `VAULT_EVENTS_V1` imported from `@qredit/qore/abi` (Task 15 picks the event by version).
- `apps/fe/src/components/shared/vaultErrors.ts`: delete the `TrappedNoOwnerClaim` entry and add:

```ts
  Ended: "The loan has ended, so the vault refuses this action.",
  OverOrderPrice: "This payment would cost more than the price of the order.",
  NotInReview: "This order is not waiting for a review.",
  ReviewOpen: "The review of this order has not ended yet.",
  ReviewOver: "The review of this order has ended, so it can no longer be rejected.",
  OwnerClaimNotAhead: "The owner can claim only while the loan is one installment ahead of its schedule.",
  NotDefaultable: "The loan is not far enough behind its schedule or past its maturity to be defaulted.",
  BuyerNotAllowed: "The owner, the agent and the suppliers of this business cannot buy from it.",
  NotAgent: "Only the agent of the vault can do this.",
```

- `engine/businesses.json`: add to each `loan` object (the schedule reaches the debt by maturity; periods, installments and grace stay as they are):
  - `counterparty-check`: `"maturitySeconds": 4752000, "maturityGraceSeconds": 86400, "defaultAfterMissed": 3`
  - `sanctions-screen`: `"maturitySeconds": 432000, "maturityGraceSeconds": 86400, "defaultAfterMissed": 3`
  - `due-diligence`: `"maturitySeconds": 79200, "maturityGraceSeconds": 3600, "defaultAfterMissed": 3`
  - `contract-auditor`: `"maturitySeconds": 1900800, "maturityGraceSeconds": 86400, "defaultAfterMissed": 3`
- `engine/src/setup/businesses.ts`: the `loan` schema becomes

```ts
  loan: z.object({
    targetUnits: units, totalOwedUnits: units, raiseSeconds: z.number().int().positive(),
    periodSeconds: z.number().int().positive(), graceSeconds: z.number().int().nonnegative(), installmentUnits: units,
    maturitySeconds: z.number().int().positive(), maturityGraceSeconds: z.number().int().nonnegative(), defaultAfterMissed: z.number().int().positive(),
  }).refine(
    (l) => BigInt(l.installmentUnits) * BigInt(Math.floor(l.maturitySeconds / l.periodSeconds)) >= BigInt(l.totalOwedUnits),
    "the schedule must reach the debt by maturity (the vault refuses it otherwise)",
  ),
```

  and `vaultInit` drops `token` (and the `FUSD_ADDRESS` import) and ends its `loan` with

```ts
      installment: BigInt(b.loan.installmentUnits),
      maturity: BigInt(b.loan.maturitySeconds),
      maturityGrace: BigInt(b.loan.maturityGraceSeconds),
      defaultAfterMissed: b.loan.defaultAfterMissed,
    },
```

- `engine/test/businesses.test.ts`: add to the `vaultInit` test

```ts
    expect("token" in init).toBe(false);
    expect(init.loan.maturity).toBe(79_200n);
    expect(init.loan.maturityGrace).toBe(3600n);
    expect(init.loan.defaultAfterMissed).toBe(3);
```

  and a new test:

```ts
  test("every business has a schedule that reaches its debt by maturity", () => {
    for (const b of loadBusinesses()) {
      const periods = BigInt(Math.floor(b.loan.maturitySeconds / b.loan.periodSeconds));
      expect(BigInt(b.loan.installmentUnits) * periods >= BigInt(b.loan.totalOwedUnits)).toBe(true);
      expect(b.loan.defaultAfterMissed).toBe(3);
    }
  });
```

- `engine/test/chain.test.ts`: import `FACTORY_START_BLOCK` from `@qredit/qore`; the fake `getBlockNumber` returns `BigInt(FACTORY_START_BLOCK + 3224)`, the fake `getLogs` returns the log when `p.fromBlock === BigInt(FACTORY_START_BLOCK + 2000)`, and the expectation is `expect(calls[0].fromBlock).toBe(BigInt(FACTORY_START_BLOCK));`.

- [ ] **Step 5: Run the tests and see them pass**

Run (in `packages/qore/`): `bun test && bun run typecheck`
Expected: all tests pass (including `immutables.test.ts` 2 and `v2.test.ts` 8), no type errors.
Run (in `engine/`): `bun test && bun run typecheck`; (in `apps/be/`): `bun test && bun run typecheck`; (in `apps/fe/`): `bun run test && bun run typecheck`
Expected: all pass. If `apps/fe` typecheck reports a v2 ABI mismatch elsewhere (for example a tuple length), fix only that line here and name it in the commit body.

- [ ] **Step 6: Verify the code hash against the chain (read-only)**

Run (in `packages/qore/`):

```bash
bun -e 'import { keccak256 } from "viem"; import { publicClientFor, TESTNET, FACTORY_ADDRESS, FACTORY_RUNTIME_CODEHASH } from "./src/index.ts"; const code = await publicClientFor(TESTNET.evm).getCode({ address: FACTORY_ADDRESS }); console.log(keccak256(code!) === FACTORY_RUNTIME_CODEHASH)'
```

Expected: `true`. If `false`, stop and report: the Proof page's factory check depends on it.

- [ ] **Step 7: Commit**

```bash
git add packages/qore engine/businesses.json engine/src/setup/businesses.ts engine/test/businesses.test.ts engine/test/chain.test.ts apps/be/src/services/watcher.ts apps/fe/src/components/shared/vaultErrors.ts apps/fe/src/modules/inbox/api/inbox.api.ts
git commit -m "feat(qore): vault v2 ABI next to the frozen v1 ABI" -m "Spec section 11: apps need the v2 ABI, the v2 factory address, the new states and order statuses, while v1 vaults stay readable, so the v1 vault ABI is frozen before regeneration and v1 events stay exported. The factory code hash now fills the immutable token with fUSD (checked against the deployed code: true). Consumers get only the compile fixes the new ABI forces. Tests: bun test and typecheck in packages/qore, engine and apps/be; vitest vaultErrors and typecheck in apps/fe." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Engine setup for v2 (bond approval, agent re-link, v1 deployments kept) and the recorded smoke run

**Files:**
- Modify: `engine/src/setup/chain.ts`, `engine/src/setup/businesses.ts`, `engine/src/setup/deployments.ts`, `engine/src/cli/owner.ts`, `engine/src/agent/chain.ts`
- Create: `engine/src/setup/smoke.ts`, `engine/scripts/smoke-v2.ts`, `engine/test/smoke.test.ts`, `engine/deployments.v1.json` (by `git mv engine/deployments.json engine/deployments.v1.json`)
- Test: `engine/test/chain.test.ts`, `engine/test/deployments.test.ts`
- Modify (after the live run): `engine/RESULTS.md`; create `engine/smoke-v2.json` (public addresses and hashes only)

**Interfaces:**
- Consumes: Task 8 `FACTORY_ABI`, `FACTORY_ADDRESS`, `bondFor`, `ERC20_ABI`, `LOAN_VAULT_ABI`, `VAULT_ABI`; `@qorechain/sdk` `revokeAuthenticatorMsg(input: { owner: string; account?: string; scheme: "ed25519" | "secp256k1"; pubkey: Uint8Array }): EncodeObject` (checked in `engine/node_modules/@qorechain/sdk/dist/index.d.ts`), `linkAuthenticatorMsgs`, `signAuthenticatorLinkEd25519`.
- Produces:
  - `type VaultInit = ReturnType<typeof vaultInit>` (businesses.ts)
  - `evmSender(acc: UnifiedAccount, c?: PublicClient): (to: Hex, data: Hex) => Promise<{ hash: Hex; receipt: TransactionReceipt }>`
  - `bondApproval(allowance: bigint, target: bigint): bigint | null`
  - `vaultFromReceipt(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[]): string | null`
  - `createVault(treasury: UnifiedAccount, init: VaultInit, c?: PublicClient): Promise<{ vault: string; startBlock: number; tx: Hex; approveTx: Hex | null }>`
  - `agentLinkMsgs(o: { spenderCosmos: string; agent: { secret: Uint8Array; publicKey: Uint8Array }; vault: string; revokeFirst: boolean; nowSeconds: number }): EncodeObject[]`
  - `linkAgent(spender: UnifiedAccount, agent: { secret: Uint8Array; publicKey: Uint8Array }, vault: string, revokeFirst?: boolean): Promise<string>`
  - `readDeploymentsV1(path?: string): Record<string, Deployment>`
  - `smokeInit(roles: { operator: Hex; ownerPq: Hex }, nowSeconds: number): VaultInit`, `SMOKE_OPERATOR = "smoke-operator"`, `SMOKE_SPENDER`, `SMOKE_PRICE = 200_000n`
  - `revertName(e: unknown): string | undefined` exported from `engine/src/agent/chain.ts`

- [ ] **Step 1: Write the failing tests**

Append to `engine/test/chain.test.ts`:

```ts
import { ed25519 } from "@noble/curves/ed25519";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { FACTORY_ABI } from "@qredit/qore";
import { agentLinkMsgs, bondApproval, vaultFromReceipt } from "../src/setup/chain.ts";

describe("v2 vault creation", () => {
  test("approves the bond only when the allowance is short", () => {
    expect(bondApproval(0n, 50_000_000n)).toBe(5_000_000n);
    expect(bondApproval(4_999_999n, 50_000_000n)).toBe(5_000_000n);
    expect(bondApproval(5_000_000n, 50_000_000n)).toBeNull();
  });
  test("reads the vault from the factory's VaultCreated log", () => {
    const vault = "0x00000000000000000000000000000000000000aa";
    const topics = encodeEventTopics({ abi: FACTORY_ABI, eventName: "VaultCreated", args: { vault, ownerPq: "0x00000000000000000000000000000000000000bb" } });
    const data = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], ["0x00000000000000000000000000000000000000cc", "0x00000000000000000000000000000000000000dd", 0n]);
    expect(vaultFromReceipt([{ address: FACTORY_ADDRESS, data, topics: topics as `0x${string}`[] }])).toBe(vault);
    expect(vaultFromReceipt([{ address: "0x00000000000000000000000000000000000000ff", data, topics: topics as `0x${string}`[] }])).toBeNull();
  });
});

describe("agent link for the v2 vault", () => {
  const secret = ed25519.utils.randomPrivateKey();
  const agent = { secret, publicKey: ed25519.getPublicKey(secret) };
  const base = { spenderCosmos: "qor1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", agent, vault: "0x00000000000000000000000000000000000000aa", nowSeconds: 1_900_000_000 };
  test("revokes the v1 link first when asked", () => {
    const fresh = agentLinkMsgs({ ...base, revokeFirst: false });
    const relink = agentLinkMsgs({ ...base, revokeFirst: true });
    expect(relink.length).toBe(fresh.length + 1);
    expect(relink[0]!.typeUrl).toBe("/qorechain.abstractaccount.v1.MsgRevokeAuthenticator");
    expect(relink.slice(1).map((m) => m.typeUrl)).toEqual(fresh.map((m) => m.typeUrl));
  });
});
```

Append to `engine/test/deployments.test.ts`:

```ts
import { readDeploymentsV1 } from "../src/setup/deployments.ts";

test("the v1 deployments are kept beside the v2 file", () => {
  const v1 = readDeploymentsV1();
  expect(Object.keys(v1).sort()).toEqual(["contract-auditor", "counterparty-check", "due-diligence", "sanctions-screen"]);
  expect(v1["counterparty-check"]!.vault).toBe("0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4");
});
```

Create `engine/test/smoke.test.ts`:

```ts
import { expect, test } from "bun:test";
import { bondFor, SUPPLIERS } from "@qredit/qore";
import { SMOKE_PRICE, SMOKE_SPENDER, smokeInit } from "../src/setup/smoke.ts";

const roles = { operator: "0x00000000000000000000000000000000000000a1" as const, ownerPq: "0x00000000000000000000000000000000000000a2" as const };

test("the smoke vault passes the v2 constructor checks", () => {
  const i = smokeInit(roles, 1_000_000);
  const l = i.loan;
  expect(l.installment * (l.maturity / l.period) >= l.totalOwed).toBe(true);
  expect(l.defaultAfterMissed).toBe(3);
  expect(bondFor(l.target)).toBe(100_000n);
  expect(l.raiseDeadline).toBe(1_003_600n);
  expect(i.ownerPayout).toBe(roles.ownerPq);
  expect(i.servicePrices).toEqual([SMOKE_PRICE]);
});

test("no role of the smoke vault is a supplier", () => {
  const i = smokeInit(roles, 1_000_000);
  const supplier = SUPPLIERS.dataIndexer;
  expect(i.suppliers).toEqual([supplier]);
  for (const role of [SMOKE_SPENDER, i.operator, i.ownerPq]) expect(role.toLowerCase()).not.toBe(supplier);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run (in `engine/`): `bun test test/chain.test.ts test/deployments.test.ts test/smoke.test.ts`
Expected: failures: `Export named 'bondApproval' not found`, `Export named 'readDeploymentsV1' not found`, `Cannot find module '../src/setup/smoke.ts'`.

- [ ] **Step 3: Implement**

Run (in the repo root): `git mv engine/deployments.json engine/deployments.v1.json`

In `engine/src/setup/deployments.ts` add:

```ts
const V1 = join(import.meta.dir, "..", "..", "deployments.v1.json");

/** The v1 vaults (kept on chain, no longer served); `deployments.json` holds the v2 vaults. */
export const readDeploymentsV1 = (path = V1): Record<string, Deployment> => readDeployments(path);
```

In `engine/src/setup/businesses.ts` add after `vaultInit`: `export type VaultInit = ReturnType<typeof vaultInit>;`

In `engine/src/agent/chain.ts` change `function revertName(` to `export function revertName(`.

In `engine/src/setup/chain.ts`: add `revokeAuthenticatorMsg` to the `@qorechain/sdk` import, `bondFor` to the `@qredit/qore` import, `type Hex, type TransactionReceipt` to the `viem` import, replace `import type { vaultInit }` with `import type { VaultInit } from "./businesses.ts";`, and replace `createVault`, `linkAgent` and the body of `lend` with:

```ts
/** Sends EVM transactions from `acc` and waits for each receipt; a reverted receipt throws with the hash. */
export function evmSender(acc: UnifiedAccount, c: PublicClient = client) {
  const wallet = walletFor(acc.privateKey as Hex, TESTNET.evm);
  return async (to: Hex, data: Hex): Promise<{ hash: Hex; receipt: TransactionReceipt }> => {
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: wallet.chain, to, data });
    const receipt = await c.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
    return { hash, receipt };
  };
}

/** The amount to approve for the factory before a create, or null when the allowance already covers the bond. */
export const bondApproval = (allowance: bigint, target: bigint): bigint | null => {
  const bond = bondFor(target);
  return allowance >= bond ? null : bond;
};

/** The vault of the factory's VaultCreated log in a receipt, lowercase; null when there is none. */
export function vaultFromReceipt(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[]): string | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== FACTORY_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: FACTORY_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "VaultCreated") return (ev.args.vault as string).toLowerCase();
    } catch {
      // not a factory event
    }
  }
  return null;
}

/** Creates a vault through the v2 factory. The factory pulls the owner's bond, so the treasury approves it first when needed. */
export async function createVault(treasury: UnifiedAccount, init: VaultInit, c: PublicClient = client) {
  const send = evmSender(treasury, c);
  const allowance = (await c.readContract({
    address: FUSD_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [treasury.evm as Hex, FACTORY_ADDRESS],
  })) as bigint;
  const approve = bondApproval(allowance, init.loan.target);
  const approveTx = approve === null
    ? null
    : (await send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [FACTORY_ADDRESS, approve] }))).hash;
  const { hash, receipt } = await send(FACTORY_ADDRESS, encodeFunctionData({ abi: FACTORY_ABI, functionName: "create", args: [init] }));
  const vault = vaultFromReceipt(receipt.logs);
  if (!vault) throw new Error(`no VaultCreated event in ${hash}`);
  return { vault, startBlock: Number(receipt.blockNumber), tx: hash, approveTx };
}

/**
 * The messages that link the agent key to the spender for one vault's paySupplier. With `revokeFirst` the key's
 * earlier link (the v1 vault) is revoked in the same transaction, so the key can be linked again.
 */
export function agentLinkMsgs(o: {
  spenderCosmos: string; agent: { secret: Uint8Array; publicKey: Uint8Array }; vault: string; revokeFirst: boolean; nowSeconds: number;
}) {
  const proof = signAuthenticatorLinkEd25519({ chainId: net.chainId, account: o.spenderCosmos, privateKey: o.agent.secret });
  const link = linkAuthenticatorMsgs({
    owner: o.spenderCosmos, chainId: net.chainId, ...proof,
    permissions: ["evm"],
    expiryUnix: o.nowSeconds + 30 * 24 * 3600,
    label: "qredit agent",
    spendingRule: {
      id: "agent", enabled: true, perTxLimit: "1000000", dailyLimit: "5000000", allowedDenoms: ["uqor"],
      allowedEvmCalls: [`${o.vault.toLowerCase()}/${PAY_SUPPLIER_SELECTOR}`],
    },
  });
  if (!o.revokeFirst) return link;
  return [revokeAuthenticatorMsg({ owner: o.spenderCosmos, scheme: "ed25519", pubkey: o.agent.publicKey }), ...link];
}

export async function linkAgent(spender: UnifiedAccount, agent: { secret: Uint8Array; publicKey: Uint8Array }, vault: string, revokeFirst = false): Promise<string> {
  const msgs = agentLinkMsgs({ spenderCosmos: spender.cosmos, agent, vault, revokeFirst, nowSeconds: Math.floor(Date.now() / 1000) });
  return confirmed(await broadcastHybrid(net, spender, msgs, { memo: "link qredit agent" }), "agent link");
}
```

In `lend`, replace the local `wallet`/`send` pair with `const send = async (to: Hex, data: Hex) => (await evmSender(lender)(to, data)).hash;` (the rest of `lend` stays).

In `engine/src/cli/owner.ts` `business create`: import `readDeploymentsV1`; replace `linkTx: await linkAgent(spender, agent, d.vault)` with `linkTx: await linkAgent(spender, agent, d.vault, Boolean(readDeploymentsV1()[b.slug]?.linkTx))`, add `version: 2,` to the `registerBusiness` body, and print the bond approval: after `v = await createVault(treasury, init);` add `if (v.approveTx) console.log(`${b.slug}: bond approval ${v.approveTx}`);`.

Create `engine/src/setup/smoke.ts`:

```ts
import { SUPPLIERS } from "@qredit/qore";
import type { VaultInit } from "./businesses.ts";

type Hex = `0x${string}`;

/** The keystore name of the operator account the smoke run creates; it serves only the smoke vault. */
export const SMOKE_OPERATOR = "smoke-operator";
/** The smoke vault never pays a supplier, so its spender is a fixed address that no key controls. */
export const SMOKE_SPENDER = "0x000000000000000000000000000000000000dEaD" as const;
export const SMOKE_PRICE = 200_000n;

/**
 * A one-fUSD vault with 600-second periods and no grace, so it falls three installments behind and can be defaulted
 * within the smoke run. 12 installments of 0.1 fUSD reach the 1.1 fUSD owed by maturity (7200 seconds).
 */
export function smokeInit(roles: { operator: Hex; ownerPq: Hex }, nowSeconds: number): VaultInit {
  return {
    spender: SMOKE_SPENDER,
    operator: roles.operator,
    ownerPq: roles.ownerPq,
    ownerPayout: roles.ownerPq,
    cosmosChainId: "qorechain-diana",
    lenderBps: 3000,
    ownerBps: 2000,
    dailyCap: 1_000_000n,
    orderTtl: 3600n,
    loan: {
      target: 1_000_000n,
      totalOwed: 1_100_000n,
      raiseDeadline: BigInt(nowSeconds + 3600),
      period: 600n,
      grace: 0n,
      installment: 100_000n,
      maturity: 7200n,
      maturityGrace: 600n,
      defaultAfterMissed: 3,
    },
    suppliers: [SUPPLIERS.dataIndexer],
    supplierCaps: [100_000n],
    servicePrices: [SMOKE_PRICE],
  };
}
```

Create `engine/scripts/smoke-v2.ts`:

```ts
// Vault v2 smoke run on qorechain-diana (vault v2 spec, section 12). It spends testnet QOR and fUSD: run it only after
// the human said yes. Phase a creates and raises a small vault, buys three orders as the demo buyer, delivers them as
// the smoke operator, accepts order 1, rejects order 2 and records read-only refusals. Phase b, once the review of
// order 3 has ended and the loan is three installments behind, settles order 3, triggers the default and claims the
// sweep as the lender. Every hash goes to smoke-v2.json (public data only).
//   bun --env-file=.env scripts/smoke-v2.ts a|b
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUYER_WINDOW, ERC20_ABI, FACTORY_ADDRESS, FUSD_ADDRESS, LOAN_VAULT_ABI, publicClientFor, TESTNET, VAULT_ABI } from "@qredit/qore";
import { encodeFunctionData, keccak256, toHex, type Hex } from "viem";
import { revertName } from "../src/agent/chain.ts";
import { keysDir } from "../src/config.ts";
import { keystore } from "../src/keystore.ts";
import { ensureAccounts, loadAccount } from "../src/setup/accounts.ts";
import { createVault, ensureWindow, evmSender, lend, registerKey, sendQor, TREASURY_WINDOW } from "../src/setup/chain.ts";
import { DEMO_BUYER } from "../src/setup/demo-buyer.ts";
import { SMOKE_OPERATOR, SMOKE_PRICE, smokeInit } from "../src/setup/smoke.ts";

type Run = { vault: Hex; startBlock: number; txs: Record<string, string>; refusals: Record<string, string> };
const OUT = join(import.meta.dir, "..", "smoke-v2.json");
const pub = publicClientFor(TESTNET.evm);
const ks = keystore(keysDir());
const save = (r: Run) => writeFileSync(OUT, `${JSON.stringify(r, null, 2)}\n`);
const vaultCall = (functionName: string, args: unknown[] = []) => encodeFunctionData({ abi: VAULT_ABI, functionName, args } as never);

/** A dry run that must be refused; returns the vault error name (no transaction is sent). */
async function refusedWith(vault: Hex, from: Hex, functionName: string, args: unknown[] = []): Promise<string> {
  try {
    await pub.simulateContract({ address: vault, abi: LOAN_VAULT_ABI, functionName, args, account: from } as never);
    return "NOT REFUSED";
  } catch (e) {
    return revertName(e) ?? "refused without a decoded reason";
  }
}

async function phaseA(): Promise<void> {
  if (existsSync(OUT)) throw new Error("smoke-v2.json exists: phase a already ran; run phase b");
  ensureAccounts(ks, [SMOKE_OPERATOR]);
  const [treasury, buyer, operator] = await Promise.all([loadAccount(ks, "treasury"), loadAccount(ks, DEMO_BUYER), loadAccount(ks, SMOKE_OPERATOR)]);
  const txs: Record<string, string> = {};
  txs.fundOperator = await sendQor(treasury, [operator.cosmos], 2_000_000n);
  const registered = await registerKey(operator);
  if (registered) txs.registerOperator = registered;
  const treasuryWindow = await ensureWindow(treasury, [FACTORY_ADDRESS, FUSD_ADDRESS], TREASURY_WINDOW);
  if (treasuryWindow) txs.treasuryWindow = treasuryWindow;

  const init = smokeInit({ operator: operator.evm as Hex, ownerPq: treasury.evm as Hex }, Math.floor(Date.now() / 1000));
  const created = await createVault(treasury, init);
  if (created.approveTx) txs.approveBond = created.approveTx;
  txs.create = created.tx;
  const vault = created.vault as Hex;
  const run: Run = { vault, startBlock: created.startBlock, txs, refusals: {} };
  save(run);

  const raised = await lend(treasury, vault, init.loan.target);
  if (!raised.depositTx) throw new Error(`the raise was skipped: ${raised.skipped}`);
  txs.deposit = raised.depositTx;

  const buyerWindow = await ensureWindow(buyer, [FUSD_ADDRESS, vault], BUYER_WINDOW);
  if (buyerWindow) txs.buyerWindow = buyerWindow;
  const asBuyer = evmSender(buyer);
  txs.approvePrice = (await asBuyer(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, 3n * SMOKE_PRICE] }))).hash;
  for (const id of [1, 2, 3]) txs[`buy${id}`] = (await asBuyer(vault, vaultCall("buy", [0n, keccak256(toHex(`smoke-request-${id}`))]))).hash;

  const operatorWindow = await ensureWindow(operator, [vault]);
  if (operatorWindow) txs.operatorWindow = operatorWindow;
  const asOperator = evmSender(operator);
  for (const id of [1, 2, 3]) txs[`deliver${id}`] = (await asOperator(vault, vaultCall("deliver", [BigInt(id), keccak256(toHex(`smoke-report-${id}`))]))).hash;

  txs.accept1 = (await asBuyer(vault, vaultCall("accept", [1n]))).hash;
  txs.reject2 = (await asBuyer(vault, vaultCall("reject", [2n]))).hash;

  run.refusals.buyFromOwner = await refusedWith(vault, treasury.evm as Hex, "buy", [0n, keccak256(toHex("smoke-owner-buy"))]);
  run.refusals.settleBeforeReviewEnds = await refusedWith(vault, treasury.evm as Hex, "settle", [3n]);
  run.refusals.ownerClaimNotAhead = await refusedWith(vault, treasury.evm as Hex, "claimOwner");
  const nonce = (await pub.readContract({ address: vault, abi: LOAN_VAULT_ABI, functionName: "policyNonce" })) as bigint;
  const block = await pub.getBlock();
  run.refusals.closeByNonOwner = await refusedWith(vault, buyer.evm as Hex, "applyOrder", [
    { kind: 8, target: "0x0000000000000000000000000000000000000000", value: 0n, nonce, expiry: block.timestamp + 600n }, "0xdeadbeef",
  ]);
  save(run);
  const order3 = (await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "orders", args: [3n] })) as readonly unknown[];
  console.log(JSON.stringify(run, null, 2));
  console.log(`phase b can run once the review of order 3 ends: ${new Date(Number(order3[6]) * 1000).toISOString()}`);
}

async function phaseB(): Promise<void> {
  const run = JSON.parse(readFileSync(OUT, "utf8")) as Run;
  const treasury = await loadAccount(ks, "treasury");
  const order3 = (await pub.readContract({ address: run.vault, abi: VAULT_ABI, functionName: "orders", args: [3n] })) as readonly unknown[];
  const now = (await pub.getBlock()).timestamp;
  if (now <= (order3[6] as bigint)) throw new Error("the review of order 3 has not ended yet");
  if (!(await pub.readContract({ address: run.vault, abi: VAULT_ABI, functionName: "defaultable" }))) throw new Error("the loan is not defaultable yet");
  const w = await ensureWindow(treasury, [run.vault, FUSD_ADDRESS, FACTORY_ADDRESS], TREASURY_WINDOW);
  if (w) run.txs.treasuryWindowB = w;
  const asTreasury = evmSender(treasury);
  run.txs.settle3 = (await asTreasury(run.vault, vaultCall("settle", [3n]))).hash;
  run.txs.triggerDefault = (await asTreasury(run.vault, vaultCall("triggerDefault"))).hash;
  run.txs.claimSweep = (await asTreasury(run.vault, vaultCall("claimLender"))).hash;
  run.refusals.buyAfterDefault = await refusedWith(run.vault, treasury.evm as Hex, "buy", [0n, keccak256(toHex("smoke-late-buy"))]);
  save(run);
  console.log(JSON.stringify(run, null, 2));
  console.log("swept", String(await pub.readContract({ address: run.vault, abi: VAULT_ABI, functionName: "swept" })));
}

const phase = process.argv[2];
if (phase === "a") await phaseA();
else if (phase === "b") await phaseB();
else console.log("usage: bun --env-file=.env scripts/smoke-v2.ts a|b");
```

- [ ] **Step 4: Run the tests and see them pass**

Run (in `engine/`): `bun test && bun run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit the code**

```bash
git add engine/src/setup/chain.ts engine/src/setup/businesses.ts engine/src/setup/deployments.ts engine/src/setup/smoke.ts engine/src/cli/owner.ts engine/src/agent/chain.ts engine/scripts/smoke-v2.ts engine/test/chain.test.ts engine/test/deployments.test.ts engine/test/smoke.test.ts engine/deployments.v1.json
git commit -m "feat(engine): v2 vault setup and the smoke run script" -m "Spec sections 3, 10 and 12: vault creation approves the factory for the bond, the agent key is re-linked to the v2 vault (revoking the v1 link in the same transaction), v1 deployments are kept in deployments.v1.json, and smoke-v2.ts runs deploy, raise, buy, deliver, accept, reject, settle and default on a one-fUSD vault. Tests: bun test and typecheck in engine (offline; the live run is the next step)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git mv` already staged the rename to `engine/deployments.v1.json`.)

- [ ] **Step 6: STOP: ask the human, then run phase a**

Check the funds read-only first: `bun run owner accounts show` (QOR of `treasury` and `demo-buyer`) and `cast call 0x97143B771D34ddb9130b807b135Ae675A5a963CA "balanceOf(address)(uint256)" <treasury evm> --rpc-url https://evm-testnet.qore.host` (phase a needs 1.1 fUSD from the treasury and 0.6 fUSD from the demo buyer, plus QOR fees). Ask: "Ready to run the v2 smoke run phase a on qorechain-diana: it funds a new smoke-operator account with 2 QOR, creates a smoke vault (0.1 fUSD bond), lends 1 fUSD and buys three 0.2 fUSD orders. Go ahead?" Wait for a yes.
Run (in `engine/`): `bun --env-file=.env scripts/smoke-v2.ts a`
Expected: the JSON record with `create`, `deposit`, `buy1..3`, `deliver1..3`, `accept1`, `reject2` hashes, and `refusals` `{ buyFromOwner: "BuyerNotAllowed", settleBeforeReviewEnds: "ReviewOpen", ownerClaimNotAhead: "OwnerClaimNotAhead", closeByNonOwner: "BadPqcSignature" }` (`closeByNonOwner` reads `OwnerKeyNotRegistered` or `OwnerKeyNotProven` if the treasury, the smoke owner, has no proven ML-DSA key; record what the chain answered). If the agent link or any step is refused in a way this plan did not expect, stop and report what the chain answered.

- [ ] **Step 7: STOP: ask the human, then run phase b**

Phase b needs the review of order 3 to be over (the script prints when) and the loan three installments behind. Continue with Tasks 10 to 12 meanwhile; Task 13 needs both phases recorded. Ask: "Ready to run phase b: settle order 3, trigger the default and claim the sweep (QOR fees only). Go ahead?" Wait for a yes.
Run (in `engine/`): `bun --env-file=.env scripts/smoke-v2.ts b`
Expected: `settle3`, `triggerDefault` and `claimSweep` hashes, `refusals.buyAfterDefault: "Ended"`, and `swept` above `0`.

- [ ] **Step 8: Record and commit**

Append to `engine/RESULTS.md`:

```markdown
## Vault v2 smoke run (qorechain-diana)

Factory `<FACTORY_V2>`; smoke vault `<vault from smoke-v2.json>` (block <startBlock>). Script: `engine/scripts/smoke-v2.ts`; raw record: `engine/smoke-v2.json`.

| Step | Result | Tx |
|---|---|---|
| Create (bond 0.1 fUSD pulled by the factory) | PASS | `<approveBond>`, `<create>` |
| Raise 1 fUSD (activates) | PASS | `<deposit>` |
| Buy orders 1 to 3 | PASS | `<buy1>`, `<buy2>`, `<buy3>` |
| Deliver orders 1 to 3 (review opens, escrow kept) | PASS | `<deliver1>`, `<deliver2>`, `<deliver3>` |
| Buyer accepts order 1 (split) | PASS | `<accept1>` |
| Buyer rejects order 2 (refund, no supplier cost) | PASS | `<reject2>` |
| Anyone settles order 3 after its review | PASS | `<settle3>` |
| Anyone triggers the default (three installments behind) | PASS | `<triggerDefault>` |
| Lender claims the sweep | PASS | `<claimSweep>` |
| Buy from the owner's address | Refused in a dry run: `BuyerNotAllowed` | none (eth_call) |
| Settle before the review ends | Refused in a dry run: `ReviewOpen` | none (eth_call) |
| Owner claim while not ahead | Refused in a dry run: `OwnerClaimNotAhead` | none (eth_call) |
| Close signed by a non-owner | Refused in a dry run: `BadPqcSignature` | none (eth_call) |
| Buy after the default | Refused in a dry run: `Ended` | none (eth_call) |
```

Fill every `<…>` from `engine/smoke-v2.json`; a step that did not pass is written as it happened, never as PASS.

```bash
git add engine/RESULTS.md engine/smoke-v2.json
git commit -m "docs(engine): record the vault v2 smoke run" -m "Spec section 12 asks for a recorded testnet run before the app switches to v2. Evidence: the transaction hashes and dry-run refusals in engine/RESULTS.md and engine/smoke-v2.json." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Backend: migration 003 and the v2 store (version, ended, review statuses, stats)

**Files:**
- Create: `apps/be/migrations/003_vault_v2.sql`
- Modify: `apps/be/src/db/store/businesses.ts`, `apps/be/src/db/store/orders.ts`, `apps/be/src/db/store/index.ts`
- Test: `apps/be/test/db/store.test.ts`, `apps/be/test/db/migrate.test.ts`, `apps/be/test/services/watcher.test.ts` (event shape only)

**Interfaces:**
- Consumes: `VaultVersion` from `@qredit/qore` (Task 8).
- Produces:
  - `Business` gains `version: VaultVersion` and `ended: "defaulted" | "closed" | null`; `BusinessInput = Omit<Business, "version" | "ended"> & { version?: VaultVersion }`
  - `upsertBusiness(db, b: BusinessInput)` (conflict on `vault`), `getBusiness(db, slug)` (newest version of the slug), `setBusinessEnded(db, vault, ended): Promise<boolean>`, `setBusinessAgents(db, vault, spender, operator): Promise<boolean>`
  - `ORDER_STATUSES` (`["open", "claimed", "delivered", "in_review", "settled", "rejected", "declined", "reclaimed"] as const`), `type OrderStatus`
  - `Order` gains `reviewEnds: number | null`, `refund: string | null`
  - `VaultEvent` union with `Delivered { envelopeHash; reviewEnds: number | null }`, `Settled`, `Rejected { refund }`, `LoanEnded { ended }`, `AgentRotated { spender; operator }`
  - `applyVaultEvent(db, e: VaultEvent): Promise<boolean>`
  - `type BusinessStats = { delivered: number; rejected: number; uniqueBuyers: number }`, `orderStats(db, vault?: string): Promise<Map<string, BusinessStats>>`

- [ ] **Step 1: Write the failing tests**

Append to `apps/be/test/db/store.test.ts`:

```ts
const V2 = "0x00000000000000000000000000000000000000a2";
const biz = (vault: string, version?: 1 | 2) => ({
  slug: "counterparty", vault, name: "Counterparty Check", tagline: "t", services: [{ id: 0 }], operator: V, spender: V, startBlock: 10,
  ...(version ? { version } : {}),
});
const delivered = (orderId: string, reviewEnds: number | null) => ({
  kind: "Delivered" as const, vault: V, orderId, block: 20, logIndex: 0, tx: "0xd", envelopeHash: `0x${"2".repeat(64)}`, reviewEnds,
});

describe("vault v2 businesses", () => {
  test("a slug keeps its v1 vault and gains a v2 vault; the page reads the newest", async () => {
    await store.upsertBusiness(db, biz(V));
    await store.upsertBusiness(db, biz(V2, 2));
    const all = await store.listBusinesses(db);
    expect(all.map((b) => [b.vault, b.version])).toEqual([[V, 1], [V2, 2]]);
    expect((await store.getBusiness(db, "counterparty"))?.vault).toBe(V2);
    await expect(store.upsertBusiness(db, biz("0x00000000000000000000000000000000000000a3", 2))).rejects.toThrow();
  });

  test("LoanEnded marks the business once; AgentRotated moves the agent keys", async () => {
    await store.upsertBusiness(db, biz(V2, 2));
    expect(await store.applyVaultEvent(db, { kind: "LoanEnded", vault: V2, block: 30, logIndex: 0, tx: "0xe", ended: "defaulted" })).toBe(true);
    expect(await store.applyVaultEvent(db, { kind: "LoanEnded", vault: V2, block: 31, logIndex: 0, tx: "0xf", ended: "closed" })).toBe(false);
    expect((await store.getBusiness(db, "counterparty"))?.ended).toBe("defaulted");
    const S = "0x00000000000000000000000000000000000000c1";
    const O = "0x00000000000000000000000000000000000000c2";
    expect(await store.applyVaultEvent(db, { kind: "AgentRotated", vault: V2, block: 32, logIndex: 0, tx: "0x1", spender: S, operator: O })).toBe(true);
    const b = await store.getBusiness(db, "counterparty");
    expect([b?.spender, b?.operator]).toEqual([S, O]);
  });
});

describe("vault v2 orders", () => {
  test("a v2 delivery opens the review; the review ends in a settlement", async () => {
    await store.applyVaultEvent(db, placed("1", 10));
    expect(await store.applyVaultEvent(db, delivered("1", 1_900_000_000))).toBe(true);
    let [o] = await store.listOrders(db, V);
    expect([o!.status, o!.reviewEnds]).toEqual(["in_review", 1_900_000_000]);
    expect(await store.claimNextOrder(db, [V])).toBeNull();
    expect(await store.applyVaultEvent(db, { kind: "Settled", vault: V, orderId: "1", block: 21, logIndex: 0, tx: "0xs" })).toBe(true);
    expect(await store.applyVaultEvent(db, { kind: "Settled", vault: V, orderId: "1", block: 22, logIndex: 0, tx: "0xs" })).toBe(false);
    [o] = await store.listOrders(db, V);
    expect(o!.status).toBe("settled");
  });

  test("a rejection records the refund and cannot be settled", async () => {
    await store.applyVaultEvent(db, placed("1", 10));
    await store.applyVaultEvent(db, delivered("1", 1_900_000_000));
    expect(await store.applyVaultEvent(db, { kind: "Rejected", vault: V, orderId: "1", block: 21, logIndex: 0, tx: "0xr", refund: "150000" })).toBe(true);
    expect(await store.applyVaultEvent(db, { kind: "Settled", vault: V, orderId: "1", block: 22, logIndex: 0, tx: "0xs" })).toBe(false);
    const [o] = await store.listOrders(db, V);
    expect([o!.status, o!.refund]).toEqual(["rejected", "150000"]);
  });

  test("a v1 delivery stays final", async () => {
    await store.applyVaultEvent(db, placed("1", 10));
    await store.applyVaultEvent(db, delivered("1", null));
    expect(await store.applyVaultEvent(db, { kind: "Settled", vault: V, orderId: "1", block: 21, logIndex: 0, tx: "0xs" })).toBe(false);
    const [o] = await store.listOrders(db, V);
    expect([o!.status, o!.reviewEnds]).toEqual(["delivered", null]);
  });

  test("orderStats counts deliveries, rejections and unique buyers per vault", async () => {
    await store.applyVaultEvent(db, placed("1", 10));
    await store.applyVaultEvent(db, placed("2", 11));
    await store.applyVaultEvent(db, { ...placed("3", 12), buyer: "0x00000000000000000000000000000000000000cc" });
    await store.applyVaultEvent(db, delivered("1", 1_900_000_000));
    await store.applyVaultEvent(db, delivered("2", 1_900_000_000));
    await store.applyVaultEvent(db, { kind: "Rejected", vault: V, orderId: "2", block: 21, logIndex: 0, tx: "0xr", refund: "0" });
    expect((await store.orderStats(db)).get(V)).toEqual({ delivered: 2, rejected: 1, uniqueBuyers: 2 });
    expect((await store.orderStats(db, V2)).get(V)).toBeUndefined();
  });
});
```

In the existing `apps/be/test/db/store.test.ts` and `apps/be/test/services/watcher.test.ts`, every `kind: "Delivered"` event object gains `reviewEnds: null` (these are v1 deliveries).

Append to `apps/be/test/db/migrate.test.ts`:

```ts
  test("003 accepts the v2 statuses and versions and refuses others", async () => {
    const db = await memoryDb();
    await runMigrations(db, MIGRATIONS_DIR);
    const order = (id: string, status: string) =>
      db.query(
        "insert into qredit.orders (vault, order_id, buyer, service_id, price, request_ref, deadline, status, placed_tx, placed_block) values ($1, $2, $3, 0, '5', $4, 1, $5, '0x', 1)",
        [`0x${"a".repeat(40)}`, id, `0x${"b".repeat(40)}`, `0x${"1".repeat(64)}`, status],
      );
    for (const [i, s] of ["in_review", "settled", "rejected", "delivered"].entries()) await order(String(i + 1), s);
    await expect(order("9", "bogus")).rejects.toThrow();
    const business = (vault: string, version: number) =>
      db.query(
        "insert into qredit.businesses (slug, vault, name, tagline, services, operator, spender, start_block, version) values ('s', $1, 'n', 't', '[]', $1, $1, 1, $2)",
        [vault, version],
      );
    await business(`0x${"1".repeat(40)}`, 1);
    await business(`0x${"2".repeat(40)}`, 2);
    await expect(business(`0x${"3".repeat(40)}`, 3)).rejects.toThrow();
    await expect(business(`0x${"4".repeat(40)}`, 2)).rejects.toThrow(); // one v2 vault per slug
    await db.close();
  });
```

- [ ] **Step 2: Run the tests and see them fail**

Run (in `apps/be/`): `bun test test/db`
Expected: failures: `version` is not a column of `qredit.businesses`, `store.orderStats is not a function`.

- [ ] **Step 3: Implement**

Create `apps/be/migrations/003_vault_v2.sql`:

```sql
-- Vault v2: a business can have a v1 and a v2 vault (same slug), so businesses are keyed by vault and carry the
-- version of their vault; the watcher records the end of a loan; orders gain the buyer review statuses.
alter table qredit.businesses add column version smallint not null default 1;
alter table qredit.businesses add constraint businesses_version_known check (version in (1, 2));
alter table qredit.businesses add column ended text;
alter table qredit.businesses add constraint businesses_ended_known check (ended is null or ended in ('defaulted', 'closed'));
alter table qredit.businesses drop constraint businesses_pkey;
alter table qredit.businesses add constraint businesses_pkey primary key (vault);
create unique index businesses_slug_version_idx on qredit.businesses (slug, version);

alter table qredit.orders drop constraint orders_status_check;
alter table qredit.orders add constraint orders_status_check
  check (status in ('open', 'claimed', 'delivered', 'in_review', 'settled', 'rejected', 'declined', 'reclaimed'));
alter table qredit.orders add column review_ends bigint;
alter table qredit.orders add column refund text;
alter table qredit.orders add constraint orders_refund_digits check (refund is null or refund ~ '^[0-9]+$');
create index orders_in_review_idx on qredit.orders (vault, review_ends) where status = 'in_review';
```

`businesses_pkey` and `orders_status_check` are the names Postgres gives the primary key and the inline column check of `001_init.sql`. If the migration fails with `constraint ... does not exist`, read the real names in a PGlite session (`select conname from pg_constraint where conrelid = 'qredit.orders'::regclass`) and report before changing anything; never edit 001 or 002.

Replace `apps/be/src/db/store/businesses.ts` with:

```ts
import type { VaultVersion } from "@qredit/qore";
import type { Queryable } from "../client.ts";
import { lc } from "./lc.ts";

export type Ended = "defaulted" | "closed";

export interface Business {
  slug: string;
  vault: string;
  name: string;
  tagline: string;
  services: unknown;
  operator: string;
  spender: string;
  startBlock: number;
  /** The LoanVault build of the vault; v1 vaults stay listed for old orders and positions only. */
  version: VaultVersion;
  /** Set by the watcher from LoanEnded; null while the loan runs. */
  ended: Ended | null;
}

export type BusinessInput = Omit<Business, "version" | "ended"> & { version?: VaultVersion };

export async function upsertBusiness(db: Queryable, b: BusinessInput): Promise<void> {
  await db.query(
    `insert into qredit.businesses (slug, vault, name, tagline, services, operator, spender, start_block, version)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     on conflict (vault) do update set slug = excluded.slug, name = excluded.name, tagline = excluded.tagline,
       services = excluded.services, operator = excluded.operator, spender = excluded.spender,
       start_block = excluded.start_block, version = excluded.version`,
    [b.slug, lc(b.vault), b.name, b.tagline, JSON.stringify(b.services), lc(b.operator), lc(b.spender), b.startBlock, b.version ?? 1],
  );
}

type BusinessRow = {
  slug: string; vault: string; name: string; tagline: string; services: unknown; operator: string; spender: string;
  start_block: string | number; version: string | number; ended: Ended | null;
};
const toBusiness = (r: BusinessRow): Business => ({
  slug: r.slug, vault: r.vault, name: r.name, tagline: r.tagline, services: r.services,
  operator: r.operator, spender: r.spender, startBlock: Number(r.start_block),
  version: Number(r.version) === 2 ? 2 : 1, ended: r.ended,
});

export async function listBusinesses(db: Queryable): Promise<Business[]> {
  return (await db.query<BusinessRow>("select * from qredit.businesses order by created_at, slug, version")).map(toBusiness);
}

/** The newest vault of a slug: the business page shows the v2 vault once it exists. */
export async function getBusiness(db: Queryable, slug: string): Promise<Business | null> {
  const [r] = await db.query<BusinessRow>("select * from qredit.businesses where slug = $1 order by version desc limit 1", [slug]);
  return r ? toBusiness(r) : null;
}

/** Records the end of a loan once; a later LoanEnded for the same vault changes nothing. */
export async function setBusinessEnded(db: Queryable, vault: string, ended: Ended): Promise<boolean> {
  const rows = await db.query("update qredit.businesses set ended = $2 where vault = $1 and ended is null returning 1", [lc(vault), ended]);
  return rows.length > 0;
}

/** Follows a RotateAgent order, so the relayer and the window keeper use the new keys. */
export async function setBusinessAgents(db: Queryable, vault: string, spender: string, operator: string): Promise<boolean> {
  const rows = await db.query(
    "update qredit.businesses set spender = $2, operator = $3 where vault = $1 returning 1",
    [lc(vault), lc(spender), lc(operator)],
  );
  return rows.length > 0;
}
```

Replace `apps/be/src/db/store/orders.ts` with:

```ts
import type { Queryable } from "../client.ts";
import { type Ended, setBusinessAgents, setBusinessEnded } from "./businesses.ts";
import { lc } from "./lc.ts";

/** `delivered` is the final state of a v1 order; v2 orders go `in_review` and end `settled` or `rejected`. */
export const ORDER_STATUSES = ["open", "claimed", "delivered", "in_review", "settled", "rejected", "declined", "reclaimed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  vault: string;
  orderId: string;
  buyer: string;
  serviceId: number;
  price: string;
  requestRef: string;
  deadline: number;
  status: OrderStatus;
  placedTx: string;
  placedBlock: number;
  envelopeHash: string | null;
  /** Unix seconds; set by a v2 delivery. */
  reviewEnds: number | null;
  /** fUSD units returned to the buyer by a rejection. */
  refund: string | null;
}

type Base = { vault: string; block: number; logIndex: number; tx: string };
type OrderBase = Base & { orderId: string };
export type VaultEvent =
  | (OrderBase & { kind: "OrderPlaced"; buyer: string; serviceId: number; price: string; requestRef: string; deadline: number })
  | (OrderBase & { kind: "Delivered"; envelopeHash: string; reviewEnds: number | null })
  | (OrderBase & { kind: "Settled" })
  | (OrderBase & { kind: "Rejected"; refund: string })
  | (OrderBase & { kind: "Declined" | "Reclaimed" })
  | (Base & { kind: "LoanEnded"; ended: Ended })
  | (Base & { kind: "AgentRotated"; spender: string; operator: string });

const changed = (rows: unknown[]) => rows.length > 0;

/**
 * Applies one vault event idempotently. Returns true when a row changed, false when the event was a duplicate or did
 * not fit the current state (a late or replayed event never rewrites a later one).
 */
export async function applyVaultEvent(db: Queryable, e: VaultEvent): Promise<boolean> {
  switch (e.kind) {
    case "OrderPlaced":
      return changed(await db.query(
        `insert into qredit.orders (vault, order_id, buyer, service_id, price, request_ref, deadline, status, placed_tx, placed_block)
         values ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9) on conflict (vault, order_id) do nothing returning 1`,
        [lc(e.vault), e.orderId, lc(e.buyer), e.serviceId, e.price, lc(e.requestRef), e.deadline, lc(e.tx), e.block],
      ));
    case "Delivered":
      // A v1 delivery is final; a v2 delivery opens the buyer's review.
      return changed(await db.query(
        `update qredit.orders set status = $3, envelope_hash = $4, review_ends = $5, closed_tx = $6, updated_at = now()
         where vault = $1 and order_id = $2 and status in ('open', 'claimed') returning 1`,
        [lc(e.vault), e.orderId, e.reviewEnds === null ? "delivered" : "in_review", lc(e.envelopeHash), e.reviewEnds, lc(e.tx)],
      ));
    case "Settled":
      return changed(await db.query(
        `update qredit.orders set status = 'settled', updated_at = now()
         where vault = $1 and order_id = $2 and status = 'in_review' returning 1`,
        [lc(e.vault), e.orderId],
      ));
    case "Rejected":
      return changed(await db.query(
        `update qredit.orders set status = 'rejected', refund = $3, updated_at = now()
         where vault = $1 and order_id = $2 and status = 'in_review' returning 1`,
        [lc(e.vault), e.orderId, e.refund],
      ));
    case "Declined":
    case "Reclaimed":
      return changed(await db.query(
        `update qredit.orders set status = $3, closed_tx = $4, updated_at = now()
         where vault = $1 and order_id = $2 and status in ('open', 'claimed') returning 1`,
        [lc(e.vault), e.orderId, e.kind === "Declined" ? "declined" : "reclaimed", lc(e.tx)],
      ));
    case "LoanEnded":
      return setBusinessEnded(db, e.vault, e.ended);
    case "AgentRotated":
      return setBusinessAgents(db, e.vault, e.spender, e.operator);
  }
}

type OrderRow = {
  vault: string; order_id: string; buyer: string; service_id: number; price: string; request_ref: string; deadline: string | number;
  status: OrderStatus; placed_tx: string; placed_block: string | number; envelope_hash: string | null;
  review_ends: string | number | null; refund: string | null;
};
const toOrder = (r: OrderRow): Order => ({
  vault: r.vault, orderId: r.order_id, buyer: r.buyer, serviceId: Number(r.service_id), price: r.price,
  requestRef: r.request_ref, deadline: Number(r.deadline), status: r.status, placedTx: r.placed_tx,
  placedBlock: Number(r.placed_block), envelopeHash: r.envelope_hash,
  reviewEnds: r.review_ends === null ? null : Number(r.review_ends), refund: r.refund,
});
```

Keep `claimNextOrder` as it is (it already claims only `open` and stale `claimed` orders) and `listOrders` with `status?: OrderStatus`, then add:

```ts
export type BusinessStats = { delivered: number; rejected: number; uniqueBuyers: number };

/** Per vault: orders delivered (any delivered state), orders rejected, and distinct buyers. One query; `vault` narrows it. */
export async function orderStats(db: Queryable, vault?: string): Promise<Map<string, BusinessStats>> {
  const rows = await db.query<{ vault: string; delivered: number; rejected: number; unique_buyers: number }>(
    `select vault,
        count(*) filter (where status in ('delivered', 'in_review', 'settled', 'rejected'))::int as delivered,
        count(*) filter (where status = 'rejected')::int as rejected,
        count(distinct buyer)::int as unique_buyers
     from qredit.orders where ($1::text is null or vault = $1) group by vault`,
    [vault ? lc(vault) : null],
  );
  return new Map(rows.map((r) => [r.vault, { delivered: Number(r.delivered), rejected: Number(r.rejected), uniqueBuyers: Number(r.unique_buyers) }]));
}
```

In `apps/be/src/db/store/index.ts` make sure `businesses.ts` and `orders.ts` are re-exported with `export *` (add the lines if the file lists names instead).

- [ ] **Step 4: Run the tests and see them pass**

Run (in `apps/be/`): `bun test && bun run typecheck`
Expected: all tests pass; typecheck reports nothing. (`src/services/watcher.ts` and `src/http/routes/*` still compile: `Delivered` events from the v1 source now carry `reviewEnds: null`, added in `viemLogSource` in Task 11; if typecheck flags that line here, add `reviewEnds: null` to the `Delivered` push in `viemLogSource` in this commit.)

- [ ] **Step 5: Commit**

```bash
git add apps/be/migrations/003_vault_v2.sql apps/be/src/db/store apps/be/test/db apps/be/test/services/watcher.test.ts apps/be/src/services/watcher.ts
git commit -m "feat(be): store v2 vaults, review statuses and per-vault stats" -m "Spec sections 10 and 11: a slug keeps its v1 vault and gains a v2 vault (businesses keyed by vault with a version), orders gain in_review, settled and rejected with review_ends and refund, LoanEnded and AgentRotated update the business, and one query gives the rejection rate and unique buyers per vault. Every handler stays idempotent. Tests: bun test (db, services) and typecheck in apps/be." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Backend: watcher per vault version, routes with version and stats

**Files:**
- Modify: `apps/be/src/services/watcher.ts`, `apps/be/src/server.ts`, `apps/be/src/http/routes/businesses.ts`, `apps/be/src/http/routes/orders.ts`
- Test: `apps/be/test/services/watcher.test.ts`, `apps/be/test/http/app.test.ts`

**Interfaces:**
- Consumes: Task 8 `VAULT_EVENTS`, `VAULT_EVENTS_V1`, `VaultVersion`; Task 10 store.
- Produces:
  - `LogSource.events(vault: string, from: number, to: number, version: VaultVersion): Promise<VaultEvent[]>`
  - `syncVault(db: Db, src: LogSource, vault: string, startBlock: number, version: VaultVersion, maxRange = 2000): Promise<number>`
  - `type RawLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint | null; logIndex: number | null; transactionHash: string | null }`
  - `toVaultEvent(vault: string, version: VaultVersion, l: RawLog): VaultEvent | null`
  - `GET /v1/businesses` and `GET /v1/businesses/:slug` return each business with `version`, `ended` and `stats: BusinessStats`; `POST /v1/businesses` accepts `version` (1 or 2, default 1); `GET /v1/orders?status=` accepts every `ORDER_STATUSES` value.

- [ ] **Step 1: Write the failing tests**

Append to `apps/be/test/services/watcher.test.ts` (and add `1` as the version argument to every existing `syncVault(db, src, V, start)` call, before the optional range):

```ts
import { toVaultEvent } from "../../src/services/watcher.ts";

const raw = (eventName: string, args: Record<string, unknown>) => ({ eventName, args, blockNumber: 7n, logIndex: 2, transactionHash: "0xABC" });

describe("toVaultEvent", () => {
  test("a v2 delivery carries its review end; a v1 delivery does not", () => {
    const args = { orderId: 3n, envelopeHash: `0x${"AB".repeat(32)}`, reviewEnds: 1_900_000_000n };
    expect(toVaultEvent(V, 2, raw("Delivered", args))).toEqual({
      kind: "Delivered", vault: V, orderId: "3", block: 7, logIndex: 2, tx: "0xabc", envelopeHash: `0x${"ab".repeat(32)}`, reviewEnds: 1_900_000_000,
    });
    expect(toVaultEvent(V, 1, raw("Delivered", { ...args, reviewEnds: undefined }))).toMatchObject({ kind: "Delivered", reviewEnds: null });
  });
  test("settlement, rejection, ending and rotation", () => {
    expect(toVaultEvent(V, 2, raw("Settled", { orderId: 3n }))).toMatchObject({ kind: "Settled", orderId: "3" });
    expect(toVaultEvent(V, 2, raw("Rejected", { orderId: 3n, refund: 150_000n, cost: 50_000n }))).toMatchObject({ kind: "Rejected", refund: "150000" });
    expect(toVaultEvent(V, 2, raw("LoanEnded", { kind: 1 }))).toMatchObject({ kind: "LoanEnded", ended: "defaulted" });
    expect(toVaultEvent(V, 2, raw("LoanEnded", { kind: 2 }))).toMatchObject({ kind: "LoanEnded", ended: "closed" });
    expect(toVaultEvent(V, 2, raw("LoanEnded", { kind: 0 }))).toBeNull();
    expect(toVaultEvent(V, 2, raw("AgentRotated", { spender: "0xAA", operator: "0xBB" }))).toMatchObject({ kind: "AgentRotated", spender: "0xaa", operator: "0xbb" });
    expect(toVaultEvent(V, 2, raw("Unknown", {}))).toBeNull();
  });
});

describe("syncVault per version", () => {
  test("asks the source for the vault's own version", async () => {
    const seen: number[] = [];
    const src: LogSource = { latestBlock: async () => 10, events: async (_v, _f, _t, version) => { seen.push(version); return []; } };
    await syncVault(db, src, V, 5, 2);
    expect(seen).toEqual([2]);
  });
});
```

In `apps/be/test/http/app.test.ts`, in the `businesses, orders, claims and decisions` test, after the first POST add:

```ts
    const listed = (await (await app.request("/v1/businesses")).json()) as { version: number; ended: null; stats: { delivered: number; rejected: number; uniqueBuyers: number } }[];
    expect(listed[0]).toMatchObject({ version: 1, ended: null, stats: { delivered: 0, rejected: 0, uniqueBuyers: 0 } });
    expect((await post("/v1/businesses", { ...biz, vault: `0x${"9".repeat(40)}`, version: 2 }, engine)).status).toBe(204);
    expect(((await (await app.request("/v1/businesses/counterparty")).json()) as { version: number }).version).toBe(2);
    expect((await post("/v1/businesses", { ...biz, vault: `0x${"8".repeat(40)}`, version: 3 }, engine)).status).toBe(400);
    expect((await app.request(`/v1/orders?vault=${V}&status=in_review`)).status).toBe(200);
```

and change the later `.length).toBe(1)` check on `/v1/businesses` (if it runs after these lines) to `toBe(2)`.

- [ ] **Step 2: Run the tests and see them fail**

Run (in `apps/be/`): `bun test test/services/watcher.test.ts test/http/app.test.ts`
Expected: failures: `Export named 'toVaultEvent' not found` and `stats` missing in `/v1/businesses`.

- [ ] **Step 3: Implement**

Replace `apps/be/src/services/watcher.ts` with:

```ts
import type { PublicClient } from "viem";
import { VAULT_EVENTS, VAULT_EVENTS_V1, type VaultVersion } from "@qredit/qore";
import type { Db } from "../db/client.ts";
import { applyVaultEvent, type Ended, getWatchState, setWatchState, type VaultEvent } from "../db/store/index.ts";

export interface LogSource {
  latestBlock(): Promise<number>;
  events(vault: string, from: number, to: number, version: VaultVersion): Promise<VaultEvent[]>;
}

/** Bring one vault's orders up to the chain head, decoding the events of the vault's own version. Returns the last block scanned. */
export async function syncVault(db: Db, src: LogSource, vault: string, startBlock: number, version: VaultVersion, maxRange = 2000): Promise<number> {
  const saved = await getWatchState(db, vault);
  let from = saved === null ? startBlock : saved + 1;
  const head = await src.latestBlock();
  if (saved !== null && saved > head) {
    console.warn(`watcher: saved block ${saved} is ahead of chain head ${head} for ${vault}; skipping (chain reset or wrong node?)`);
    return saved;
  }
  let last = from - 1;
  while (from <= head) {
    const to = Math.min(head, from + maxRange - 1);
    const events = (await src.events(vault, from, to, version)).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    // Events of one range and the saved position commit together, or not at all.
    await db.transaction(async (q) => {
      for (const e of events) {
        if (!(await applyVaultEvent(q, e))) {
          console.warn(`watcher: ignored ${e.kind}${"orderId" in e ? ` for order ${e.orderId}` : ""} in block ${e.block} (duplicate or not in a state it fits)`);
        }
      }
      await setWatchState(q, vault, to);
    });
    last = to;
    from = to + 1;
  }
  return last;
}

/** A decoded log as viem returns it, loosely typed so one mapper serves both vault versions. */
export type RawLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint | null; logIndex: number | null; transactionHash: string | null };

const ENDED: Record<number, Ended> = { 1: "defaulted", 2: "closed" };

/** Maps one decoded vault log to a watcher event; null for an event the watcher does not keep. */
export function toVaultEvent(vault: string, version: VaultVersion, l: RawLog): VaultEvent | null {
  const base = { vault: vault.toLowerCase(), block: Number(l.blockNumber), logIndex: Number(l.logIndex), tx: String(l.transactionHash).toLowerCase() };
  const a = l.args;
  const order = { ...base, orderId: String(a.orderId) };
  switch (l.eventName) {
    case "OrderPlaced":
      return {
        ...order, kind: "OrderPlaced", buyer: String(a.buyer).toLowerCase(), serviceId: Number(a.serviceId), price: String(a.price),
        requestRef: String(a.requestRef).toLowerCase(), deadline: Number(a.deadline),
      };
    case "Delivered":
      return { ...order, kind: "Delivered", envelopeHash: String(a.envelopeHash).toLowerCase(), reviewEnds: version === 1 ? null : Number(a.reviewEnds) };
    case "Settled":
      return { ...order, kind: "Settled" };
    case "Rejected":
      return { ...order, kind: "Rejected", refund: String(a.refund) };
    case "Declined":
    case "Reclaimed":
      return { ...order, kind: l.eventName };
    case "LoanEnded": {
      const ended = ENDED[Number(a.kind)];
      return ended ? { ...base, kind: "LoanEnded", ended } : null;
    }
    case "AgentRotated":
      return { ...base, kind: "AgentRotated", spender: String(a.spender).toLowerCase(), operator: String(a.operator).toLowerCase() };
    default:
      return null;
  }
}

export function viemLogSource(client: PublicClient): LogSource {
  return {
    latestBlock: async () => Number(await client.getBlockNumber()),
    async events(vault, from, to, version) {
      const range = { address: vault as `0x${string}`, fromBlock: BigInt(from), toBlock: BigInt(to) };
      const logs = version === 1
        ? await client.getLogs({ ...range, events: VAULT_EVENTS_V1 })
        : await client.getLogs({ ...range, events: VAULT_EVENTS });
      const out: VaultEvent[] = [];
      for (const l of logs as unknown as RawLog[]) {
        const e = toVaultEvent(vault, version, l);
        if (e) out.push(e);
        else console.warn(`watcher: skipped ${l.eventName} in block ${Number(l.blockNumber)}`);
      }
      return out;
    },
  };
}
```

In `apps/be/src/server.ts` the watcher loop becomes `for (const b of await listBusinesses(db)) await syncVault(db, logs, b.vault, b.startBlock, b.version);`.

Replace `apps/be/src/http/routes/businesses.ts` with:

```ts
import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.ts";
import * as store from "../../db/store/index.ts";
import type { EngineAuth } from "../middleware/engine-auth.ts";
import { bad, evmAddress, parseBody } from "../validation.ts";

const businessSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/), vault: evmAddress, name: z.string().min(1).max(80),
  tagline: z.string().max(200), services: z.custom<unknown>((v) => v !== undefined), operator: evmAddress, spender: evmAddress,
  startBlock: z.number().int().nonnegative(),
  version: z.union([z.literal(1), z.literal(2)]).default(1),
});

const NO_STATS: store.BusinessStats = { delivered: 0, rejected: 0, uniqueBuyers: 0 };

export function businessRoutes(app: Hono, deps: { db: Db; auth: EngineAuth }): void {
  app.get("/v1/businesses", async (c) => {
    const [list, stats] = await Promise.all([store.listBusinesses(deps.db), store.orderStats(deps.db)]);
    return c.json(list.map((b) => ({ ...b, stats: stats.get(b.vault) ?? NO_STATS })));
  });
  app.get("/v1/businesses/:slug", async (c) => {
    const b = await store.getBusiness(deps.db, c.req.param("slug"));
    if (!b) return bad(c, "not found", 404);
    const stats = await store.orderStats(deps.db, b.vault);
    return c.json({ ...b, stats: stats.get(b.vault) ?? NO_STATS });
  });
  app.post("/v1/businesses", deps.auth.requireEngine, async (c) => {
    const b = await parseBody(c, businessSchema);
    if (!b) return bad(c, "invalid business");
    await store.upsertBusiness(deps.db, { ...b, services: b.services });
    return c.body(null, 204);
  });
}
```

In `apps/be/src/http/routes/orders.ts` replace the status parse with `const status = z.enum(store.ORDER_STATUSES).optional().safeParse(c.req.query("status"));`.

- [ ] **Step 4: Run the tests and see them pass**

Run (in `apps/be/`): `bun test && bun run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/be/src/services/watcher.ts apps/be/src/server.ts apps/be/src/http/routes/businesses.ts apps/be/src/http/routes/orders.ts apps/be/test/services/watcher.test.ts apps/be/test/http/app.test.ts
git commit -m "feat(be): watch v1 and v2 vaults with their own events" -m "Spec section 11: the watcher decodes each vault with the events of its version (Delivered differs), keeps Delivered, Settled, Rejected, LoanEnded and AgentRotated, and the business routes carry version, ended and the stats behind the rejection rate and unique buyers. Tests: bun test and typecheck in apps/be." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Engine agent: order read from the vault, operator settle, settle loop

**Files:**
- Create: `engine/src/agent/settle.ts`, `engine/test/settle.test.ts`
- Modify: `engine/src/agent/types.ts`, `engine/src/agent/chain.ts`, `engine/src/agent/pipeline.ts`, `engine/src/agent/run.ts`, `engine/src/agent/api.ts`
- Test: `engine/test/pipeline.test.ts`, `engine/test/agent-chain.test.ts`, `engine/test/run.test.ts`, `engine/test/agent-api.test.ts`

**Interfaces:**
- Consumes: Task 8 `VAULT_ABI` (`orders`, `settle`, errors `NotInReview`, `ReviewOpen`), `ORDER_STATUS`, `VAULT_STATE`; Task 11 `GET /v1/orders?vault=&status=in_review` (orders carry `reviewEnds`).
- Produces:
  - `type ChainOrder = { buyer: string; serviceId: number; deadline: number; status: number; price: bigint; requestRef: string; reviewEnds: number }` (types.ts)
  - `createVaultReader(...).order(vault: string, orderId: bigint): Promise<ChainOrder>`
  - `createOperator(...).settle(vault: string, orderId: bigint): Promise<CloseResult>` (`NotInReview` is `alreadyClosed`)
  - `readChainOrder(claimed: Order, deps: Pick<PipelineDeps, "vaults">): Promise<Order | null>`, `orderDiffers(a: Order, b: Order): boolean` (pipeline.ts)
  - `type ReviewOrder = { orderId: string; reviewEnds: number | null }`; `settleDue(vaults: string[], deps: SettleDeps): Promise<number>`; `everyMs(fn: () => Promise<void>, ms: number, now?: () => number): () => Promise<void>` (settle.ts)
  - `api.inReview(vault: string): Promise<ReviewOrder[]>`
  - `runLoop(o)` accepts `onIdle?: () => Promise<void>`, called when no order was claimed, before sleeping.

- [ ] **Step 1: Write the failing tests**

Create `engine/test/settle.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { everyMs, settleDue, type ReviewOrder } from "../src/agent/settle.ts";

const V1 = "0x" + "11".repeat(20);
const V2 = "0x" + "22".repeat(20);

describe("settleDue", () => {
  test("settles only orders whose review has ended and keeps going after a failure", async () => {
    const lists: Record<string, ReviewOrder[]> = {
      [V1]: [{ orderId: "1", reviewEnds: 100 }, { orderId: "2", reviewEnds: 200 }, { orderId: "3", reviewEnds: null }],
      [V2]: [{ orderId: "4", reviewEnds: 50 }],
    };
    const settled: string[] = [];
    const logs: string[] = [];
    const n = await settleDue([V1, V2], {
      inReview: async (v) => lists[v]!,
      settle: async (v, id) => {
        if (id === 4n) throw new Error("rpc down");
        settled.push(`${v}:${id}`);
        return { tx: "0xs", alreadyClosed: false };
      },
      now: () => 150,
      log: (l) => logs.push(l),
    });
    expect(settled).toEqual([`${V1}:1`]);
    expect(n).toBe(1);
    expect(logs.some((l) => l.includes("order 4") && l.includes("rpc down"))).toBe(true);
  });

  test("a vault whose list cannot be read is skipped", async () => {
    const logs: string[] = [];
    const n = await settleDue([V1], {
      inReview: async () => { throw new Error("HTTP 503"); },
      settle: async () => ({ tx: "0xs", alreadyClosed: false }),
      now: () => 0,
      log: (l) => logs.push(l),
    });
    expect(n).toBe(0);
    expect(logs[0]).toContain("HTTP 503");
  });

  test("an order settled by someone else is not counted", async () => {
    const n = await settleDue([V1], {
      inReview: async () => [{ orderId: "1", reviewEnds: 1 }],
      settle: async () => ({ tx: null, alreadyClosed: true }),
      now: () => 10,
      log: () => {},
    });
    expect(n).toBe(0);
  });
});

describe("everyMs", () => {
  test("runs at most once per interval", async () => {
    let t = 0;
    let runs = 0;
    const tick = everyMs(async () => { runs++; }, 1000, () => t);
    await tick();
    t = 500;
    await tick();
    t = 1000;
    await tick();
    expect(runs).toBe(2);
  });
});
```

Append to `engine/test/run.test.ts` (inside `describe("runLoop")`):

```ts
  test("calls onIdle when nothing was claimed, before sleeping", async () => {
    const ctl = new AbortController();
    const seen: string[] = [];
    let polls = 0;
    await runLoop({
      businesses: [biz("a", V1)],
      deps: { log: () => {} } as unknown as PipelineDeps,
      pollMs: 10,
      signal: ctl.signal,
      claim: async () => { if (++polls > 2) ctl.abort(); return null; },
      onIdle: async () => { seen.push("idle"); },
      sleep: async () => { seen.push("sleep"); },
    });
    expect(seen.slice(0, 4)).toEqual(["idle", "sleep", "idle", "sleep"]);
  });
```

Append to `engine/test/agent-chain.test.ts`:

```ts
describe("v2 reads and settle", () => {
  test("order maps the vault's tuple", async () => {
    const tuple = ["0x" + "ab".repeat(20), 0, 1_900_000_000n, 1, 250_000n, `0x${"11".repeat(32)}`, 0n];
    const reader = createVaultReader({ readContract: (async () => tuple) as never, getBlock: async () => ({ timestamp: 0n }) });
    expect(await reader.order(VAULT, 7n)).toEqual({
      buyer: "0x" + "ab".repeat(20), serviceId: 0, deadline: 1_900_000_000, status: 1, price: 250_000n, requestRef: `0x${"11".repeat(32)}`, reviewEnds: 0,
    });
  });
  test("settle of an order no longer in review is an idempotent no-op", async () => {
    const notInReview = new ContractFunctionRevertedError({ abi: VAULT_ABI, data: encodeErrorResult({ abi: VAULT_ABI, errorName: "NotInReview" }), functionName: "settle" });
    const op = createOperator({
      privateKey: "0x01", evm: "x",
      clients: {
        pub: { simulateContract: (async () => { throw notInReview; }) as never, waitForTransactionReceipt: async () => ({ status: "success" }) },
        wallet: { account: { address: SPENDER }, writeContract: (async () => "0xabc") as never },
      },
    });
    expect(await op.settle(VAULT, 3n)).toEqual({ tx: null, alreadyClosed: true });
  });
});
```

In `engine/test/pipeline.test.ts`: add to `Opts` `onChain?: Partial<ChainOrder>; chainFail?: boolean;`, to `calls` `resolved: [] as string[]`, change `resolveBuyer` to `async (b) => { calls.resolved.push(b); return o.buyer === false ? null : recipientOf(buyerKeys); }`, and add to `deps.vaults`:

```ts
      order: async () => {
        if (o.chainFail) throw new Error("rpc down");
        return {
          buyer: order.buyer, serviceId: order.serviceId, deadline: order.deadline, status: 1, price: BigInt(order.price),
          requestRef: order.requestRef, reviewEnds: 0, ...o.onChain,
        };
      },
```

(import `type ChainOrder` from `../src/agent/types.ts`), then append:

```ts
describe("the order comes from the vault", () => {
  test("the report is sealed to the vault's buyer, not the backend copy", async () => {
    const chainBuyer = "0x" + "cd".repeat(20);
    const t = setup({ onChain: { buyer: chainBuyer } });
    const out = await handleOrder(t.order, t.biz, t.deps);
    expect(out.status).toBe("delivered");
    expect(t.calls.resolved).toEqual([chainBuyer]);
    expect(t.logs.some((l) => l.includes("differs from the vault"))).toBe(true);
  });
  test("an order the vault no longer holds open is not served", async () => {
    const t = setup({ onChain: { status: 2 } });
    expect(await handleOrder(t.order, t.biz, t.deps)).toEqual({ status: "already-closed" });
    expect(t.calls.relay).toEqual([]);
    expect(t.calls.deliver).toEqual([]);
  });
  test("a failed chain read fails the order for a retry", async () => {
    const t = setup({ chainFail: true });
    const out = await handleOrder(t.order, t.biz, t.deps);
    expect(out.status).toBe("failed");
    expect(t.calls.relay).toEqual([]);
  });
});
```

Append to `engine/test/agent-api.test.ts` (it builds the client with a fake `fetch`; follow the file's existing helper):

```ts
test("inReview lists the vault's orders in review", async () => {
  const seen: string[] = [];
  const api = createApi({
    url: "http://api", token: "t",
    fetch: (async (url: string) => { seen.push(url); return new Response(JSON.stringify([{ orderId: "1", reviewEnds: 99, status: "in_review" }]), { status: 200 }); }) as never,
  });
  expect(await api.inReview("0xAA")).toEqual([{ orderId: "1", reviewEnds: 99 }]);
  expect(seen[0]).toBe("http://api/v1/orders?vault=0xAA&status=in_review");
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run (in `engine/`): `bun test test/settle.test.ts test/run.test.ts test/agent-chain.test.ts test/pipeline.test.ts test/agent-api.test.ts`
Expected: failures: `Cannot find module '../src/agent/settle.ts'`, `reader.order is not a function`, `op.settle is not a function`, `api.inReview is not a function`, and the three pipeline tests.

- [ ] **Step 3: Implement**

In `engine/src/agent/types.ts` add:

```ts
/** An order as the vault stores it (`orders(id)`); `status` is `ORDER_STATUS` of a v2 vault. */
export type ChainOrder = { buyer: string; serviceId: number; deadline: number; status: number; price: bigint; requestRef: string; reviewEnds: number };
```

In `engine/src/agent/chain.ts`, `createOperator`: change `close` to take `functionName: "deliver" | "decline" | "settle", args: readonly unknown[]`, treat `NotInReview` like `OrderNotOpen`, and return `settle`:

```ts
      if (name === "OrderNotOpen" || name === "NotInReview") return { tx: null, alreadyClosed: true };
```

```ts
  return {
    deliver: (vault: string, orderId: bigint, envelopeHash: Hex) => close(vault, "deliver", [orderId, envelopeHash]),
    decline: (vault: string, orderId: bigint, code: DeclineCode) => close(vault, "decline", [orderId, code]),
    /** Anyone may settle once the review has ended; the operator does it for its own orders. */
    settle: (vault: string, orderId: bigint) => close(vault, "settle", [orderId]),
  };
```

and add to the object returned by `createVaultReader`:

```ts
    async order(vault: string, orderId: bigint): Promise<ChainOrder> {
      const [buyer, serviceId, deadline, status, price, requestRef, reviewEnds] =
        await read<readonly [string, number | bigint, bigint, number | bigint, bigint, string, bigint]>(vault, "orders", [orderId]);
      return {
        buyer, serviceId: Number(serviceId), deadline: Number(deadline), status: Number(status), price, requestRef, reviewEnds: Number(reviewEnds),
      };
    },
```

(import `type ChainOrder` from `./types.ts`).

In `engine/src/agent/pipeline.ts` import `ORDER_STATUS` from `@qredit/qore`, add:

```ts
/**
 * The order as the vault holds it, or null when it is no longer open. The backend copy only says which order to serve;
 * buyer, service, price, request and deadline come from the chain, so a wrong copy can never redirect a report (L3).
 */
export async function readChainOrder(claimed: Order, deps: Pick<PipelineDeps, "vaults">): Promise<Order | null> {
  const c = await deps.vaults.order(claimed.vault, BigInt(claimed.orderId));
  if (c.status !== ORDER_STATUS.Open) return null;
  return {
    ...claimed, buyer: c.buyer.toLowerCase(), serviceId: c.serviceId, price: c.price.toString(),
    requestRef: c.requestRef.toLowerCase(), deadline: c.deadline,
  };
}

export const orderDiffers = (a: Order, b: Order): boolean =>
  a.buyer.toLowerCase() !== b.buyer.toLowerCase() || a.serviceId !== b.serviceId || a.price !== b.price
  || a.requestRef.toLowerCase() !== b.requestRef.toLowerCase() || a.deadline !== b.deadline;
```

and replace `handleOrder` with:

```ts
export async function handleOrder(claimed: Order, biz: BusinessRuntime, deps: PipelineDeps): Promise<Outcome> {
  let order: Order;
  try {
    const onChain = await readChainOrder(claimed, deps);
    if (onChain === null) return { status: "already-closed" };
    if (orderDiffers(claimed, onChain)) deps.log(`order ${claimed.orderId}: the backend copy differs from the vault; the vault's is used`);
    order = onChain;
  } catch (e) {
    return failOrder({ order: claimed, biz, deps, paid: new Map(), data: {}, query: {} }, new Retry(detail(e), "chain-order"));
  }
  const r: Run = { order, biz, deps, paid: new Map(), data: {}, query: {} };
  if ((deps.now ?? defaultNow)() >= order.deadline - EXPIRY_MARGIN_S) {
    await probeChainCost(r);
    return failOrder(r, "order expired", REASON.expired);
  }
  try {
    return await serve(r);
  } catch (e) {
    const err = e instanceof Decline ? e : classify(e);
    if (!(err instanceof Decline)) return failOrder(r, err);
    try {
      return await declineOrder(r, err);
    } catch (inner) {
      return failOrder(r, inner);
    }
  }
}
```

Supplier payments keep passing the order id (`payRequest(vault, supplier, amount, orderId)`); a payment above the order price is refused by the vault (`OverOrderPrice`), which the relayer reports as `execution_failed`, so the order is declined with code 6 and the buyer gets the price back less what was already spent. `planOrder` already keeps the planned spend within the price.

Create `engine/src/agent/settle.ts`:

```ts
import type { CloseResult } from "./chain.ts";

/** An order waiting for its buyer's review, as the backend lists it. */
export type ReviewOrder = { orderId: string; reviewEnds: number | null };

export type SettleDeps = {
  inReview(vault: string): Promise<ReviewOrder[]>;
  settle(vault: string, orderId: bigint): Promise<CloseResult>;
  /** Unix seconds. */
  now(): number;
  log(line: string): void;
};

const detail = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Settles every order of these vaults whose review has ended (the buyer neither accepted nor rejected), so the sale is
 * split and lenders are repaid. One failure never stops the others. Returns how many this run settled.
 */
export async function settleDue(vaults: string[], deps: SettleDeps): Promise<number> {
  let settled = 0;
  for (const vault of vaults) {
    let orders: ReviewOrder[];
    try {
      orders = await deps.inReview(vault);
    } catch (e) {
      deps.log(`settle: listing ${vault} failed: ${detail(e)}`);
      continue;
    }
    for (const o of orders) {
      if (o.reviewEnds === null || deps.now() <= o.reviewEnds) continue;
      try {
        const r = await deps.settle(vault, BigInt(o.orderId));
        if (r.tx) {
          settled++;
          deps.log(`order ${o.orderId}: settled tx ${r.tx}`);
        }
      } catch (e) {
        deps.log(`order ${o.orderId}: settle failed: ${detail(e)}`);
      }
    }
  }
  return settled;
}

/** Wraps `fn` so it runs at most once per `ms`; calls in between return at once. */
export function everyMs(fn: () => Promise<void>, ms: number, now: () => number = Date.now): () => Promise<void> {
  let last = Number.NEGATIVE_INFINITY;
  return async () => {
    if (now() - last < ms) return;
    last = now();
    await fn();
  };
}
```

In `engine/src/agent/api.ts` add to the returned object:

```ts
    async inReview(vault: string): Promise<{ orderId: string; reviewEnds: number | null }[]> {
      const r = (await request("GET", `/v1/orders?vault=${vault}&status=in_review`)) as { orderId: string; reviewEnds: number | null }[];
      return r.map((o) => ({ orderId: o.orderId, reviewEnds: o.reviewEnds }));
    },
```

In `engine/src/agent/run.ts`:
- add `onIdle?: () => Promise<void>;` to the `runLoop` options and, in the `if (!order)` branch before `await sleep(o.pollMs)`, run `try { await o.onIdle?.(); } catch (e) { o.deps.log(`idle work failed: ${detail(e)}`); }`;
- serve ended vaults too, so their open orders finish and their reviews settle (a settlement after the end pays lenders): `const SERVING = new Set<number>([VAULT_STATE.Active, VAULT_STATE.Trapped, VAULT_STATE.Repaid, VAULT_STATE.Defaulted, VAULT_STATE.Closed]);`
- route `settle` like `deliver` in `deps.operator`: `settle: (vault, ...rest) => operators.get(vault.toLowerCase())!.settle(vault, ...rest),`
- in `main`, build the settle tick and pass it:

```ts
  const vaults = runtimes.map((r) => r.vault);
  const settleTick = everyMs(async () => {
    await settleDue(vaults, {
      inReview: (v) => api.inReview(v), settle: (v, id) => deps.operator.settle(v, id),
      now: () => Math.floor(Date.now() / 1000), log,
    });
  }, SETTLE_EVERY_MS);
```

  with `const SETTLE_EVERY_MS = 60_000;` at module level and `onIdle: settleTick` in the `runLoop` call (import `everyMs`, `settleDue` from `./settle.ts`).

- [ ] **Step 4: Run the tests and see them pass**

Run (in `engine/`): `bun test && bun run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add engine/src/agent engine/test/settle.test.ts engine/test/pipeline.test.ts engine/test/agent-chain.test.ts engine/test/run.test.ts engine/test/agent-api.test.ts
git commit -m "feat(engine): read orders from the vault and settle due reviews" -m "Spec sections 10 and 11: the agent now serves the order as the vault holds it (the backend copy can no longer redirect a sealed report, finding L3), delivering no longer settles, and an idle tick settles the agent's own orders once their review ends; ended vaults keep finishing their open orders. Tests: bun test and typecheck in engine." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Roll out v2 on the testnet (backend, vaults, agents)

**Files:**
- Modify: `engine/deployments.json` (written by the owner CLI), `engine/RESULTS.md`

**Interfaces:**
- Consumes: Tasks 9 to 12 merged; both smoke phases recorded (Task 9 Step 8); `docs/hosting.md` for how the backend and the agent runner are deployed.
- Produces: four v2 vaults registered with `version: 2`, agents serving them, v1 rows still listed with `version: 1`.

- [ ] **Step 1: Check the preconditions (read-only)**

Run: `git log --oneline -1 -- engine/RESULTS.md` (shows the smoke record commit) and, in `engine/`, `bun run owner accounts show`; read the treasury's ERC-20 fUSD with `cast call 0x97143B771D34ddb9130b807b135Ae675A5a963CA "balanceOf(address)(uint256)" <treasury evm> --rpc-url https://evm-testnet.qore.host`.
Expected: the smoke record exists; the treasury holds at least 17.2 fUSD for the four bonds (5 + 0.2 + 2 + 10) plus what Step 4 lends (72 fUSD for counterparty-check, sanctions-screen and due-diligence), and QOR for fees. If not, stop and report the shortfall.

- [ ] **Step 2: STOP: ask the human, then deploy the backend with migration 003**

Ask: "Ready to deploy apps/be with migration 003 (it changes the businesses key and the order statuses on the hosted database). Go ahead?" Wait for a yes. Deploy as `docs/hosting.md` describes (the server applies pending migrations at boot).
Expected: the boot log prints `[migrate] applied: [ '003_vault_v2.sql' ]`; `curl https://api.qredit.fun/v1/businesses` returns the four v1 rows with `"version":1,"ended":null` and `stats`.

- [ ] **Step 3: STOP: ask the human, then create the v2 vaults**

Ask: "Ready to create the four v2 vaults from the treasury (bonds 17.2 fUSD), re-link the four agent keys to them, open the operator windows and register them with the API as version 2. Go ahead?" Wait for a yes.
Run (in `engine/`): `bun run owner business create all`
Expected per business: `bond approval 0x…` (first time), `vault 0x… (block …)`, `agent key linked …`, `operator window …`, `registered with the API`. If the re-link transaction is refused (revoke plus link in one transaction is not proven before this step), stop and report the chain's answer; the fallback is a separate revoke transaction, then the link, which needs the human's yes again.

- [ ] **Step 4: STOP: ask the human, then lend and restart the agents**

Ask: "Ready to lend 50, 2 and 20 fUSD from the treasury to counterparty-check, sanctions-screen and due-diligence (contract-auditor stays raising), and restart the agent runner on the v2 vaults?" Wait for a yes.
Run (in `engine/`): `bun run owner lend counterparty-check 50`, `bun run owner lend sanctions-screen 2`, `bun run owner lend due-diligence 20`; restart the agent runner as `docs/hosting.md` describes.
Expected: three `deposited … units (… deposit 0x…)` lines; the runner log prints `serving vault 0x…` for every v2 vault and no v1 address.

- [ ] **Step 5: Verify read-only**

Run: `curl https://api.qredit.fun/v1/businesses`
Expected: eight rows, four with `"version":2` (the v2 vaults from `engine/deployments.json`) and four with `"version":1`. For one v2 vault run `cast call <vault> "bondHeld()(uint256)" --rpc-url https://evm-testnet.qore.host` and expect the bond (for counterparty-check `5000000`).

- [ ] **Step 6: Record and commit**

Append to `engine/RESULTS.md` a section `## Vault v2 rollout` with one row per business: v2 vault, create tx, bond approval tx, link tx, window tx, lend tx (copied from the CLI output and `engine/deployments.json`).

```bash
git add engine/deployments.json engine/RESULTS.md
git commit -m "chore(engine): v2 vaults for the four businesses" -m "Spec section 10: every business now runs on a v2 vault with its bond; v1 vaults stay on chain and in the API as version 1. Evidence: create, link, window and lend hashes in engine/RESULTS.md; /v1/businesses lists both versions." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Web app foundations: v2 schemas, states, statuses, v1 reads, Market lists only v2

**Files:**
- Create: `apps/fe/src/lib/orderStatus.ts`, `apps/fe/src/test/lib/orderStatus.test.ts`, `apps/fe/src/test/components/shared/OrderStatusBadge.test.tsx`
- Modify: `apps/fe/src/lib/schemas.ts`, `apps/fe/src/lib/vaultState.ts`, `apps/fe/src/lib/chain.ts`, `apps/fe/src/components/shared/StateBadge.tsx`, `apps/fe/src/components/shared/OrderStatusBadge.tsx`, `apps/fe/src/modules/market/api/market.api.ts`, `apps/fe/src/modules/market/api/market.keys.ts`, `apps/fe/src/modules/market/api/useMarketQuery.ts`, `apps/fe/src/modules/market/schemas/vault.schema.ts`, `apps/fe/src/modules/market/index.ts`, `apps/fe/src/modules/inbox/lib/inboxOrders.ts`, `apps/fe/src/modules/inbox/components/InboxList.tsx`, `apps/fe/src/modules/inbox/components/InboxPage.tsx`, `apps/fe/src/modules/inbox/components/ReportPage.tsx`, `apps/fe/src/modules/lend/components/PositionsPage.tsx`, `apps/fe/src/modules/lend/api/lend.api.ts`
- Test: `apps/fe/src/test/lib/schemas.test.ts`, `apps/fe/src/test/components/shared/StateBadge.test.tsx`, `apps/fe/src/test/modules/market/api/market.api.test.ts`, `apps/fe/src/test/modules/inbox/lib/inboxOrders.test.ts`

**Interfaces:**
- Consumes: Task 8 `LOAN_VAULT_ABI`, `LOAN_VAULT_V1_ABI` (`@qredit/qore/abis-v1`), `VaultVersion`; Task 11 business JSON (`version`, `ended`, `stats`) and order JSON (`reviewEnds`, `refund`, new statuses).
- Produces:
  - `Business` gains `version: 1 | 2`, `ended: "defaulted" | "closed" | null`, `stats?: { delivered: number; rejected: number; uniqueBuyers: number }`; `Order` gains `reviewEnds: Date | null`, `refund: bigint | null`; `orderStatus` has the eight backend statuses.
  - `VaultStateName` adds `"Defaulted" | "Closed"`.
  - `hasReport(s: Order["status"]): boolean`, `isSettledSale(s: Order["status"]): boolean` (`@/lib/orderStatus`)
  - `readVaultV1(address, functionName, args?)` (`@/lib/chain`)
  - `VaultSnapshot` gains `version`, `bondHeld`, `swept`, `uniqueBuyers: number | null`, `maturityAt: Date | null`; `readVaultSnapshot(vault: Hex, version?: VaultVersion)`
  - `getMarket()` lists only v2 businesses; `useBusinessesQuery()` lists every business (v1 and v2) for Inbox and lending positions.

- [ ] **Step 1: Write the failing tests**

Create `apps/fe/src/test/lib/orderStatus.test.ts`:

```ts
import { expect, test } from "vitest";
import { hasReport, isSettledSale } from "@/lib/orderStatus";

test("a report exists once an order was delivered, in either vault version", () => {
  expect(["delivered", "in_review", "settled", "rejected"].every((s) => hasReport(s as never))).toBe(true);
  expect(["open", "claimed", "declined", "reclaimed"].some((s) => hasReport(s as never))).toBe(false);
});

test("only a kept report is a settled sale", () => {
  expect(isSettledSale("delivered")).toBe(true);
  expect(isSettledSale("settled")).toBe(true);
  expect(isSettledSale("in_review")).toBe(false);
  expect(isSettledSale("rejected")).toBe(false);
});
```

Create `apps/fe/src/test/components/shared/OrderStatusBadge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { OrderStatusBadge } from "@/components/shared/OrderStatusBadge";

test.each([
  ["open", "Pending"],
  ["claimed", "In progress"],
  ["delivered", "Delivered"],
  ["in_review", "In review"],
  ["settled", "Delivered"],
  ["rejected", "Rejected"],
  ["declined", "Declined"],
  ["reclaimed", "Reclaimed"],
] as const)("%s reads as %s", (status, label) => {
  render(<OrderStatusBadge status={status} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});
```

In `apps/fe/src/test/components/shared/StateBadge.test.tsx`: the mapping test becomes `expect([0, 1, 2, 3, 4, 5, 6].map(vaultStateName)).toEqual(["Raising", "Active", "Trapped", "Repaid", "Refunded", "Defaulted", "Closed"]);`, the label table gains `["Defaulted", "Defaulted"], ["Closed", "Closed"]`, and the unknown-number test uses `vaultStateName(7)` and `vaultStateName(-1)` as before (7 is still unknown).

Append to `apps/fe/src/test/lib/schemas.test.ts`:

```ts
test("a business without a version is a v1 vault; v2 carries ended and stats", () => {
  const base = {
    slug: "s", vault: `0x${"a".repeat(40)}`, name: "n", tagline: "t", services: [], operator: `0x${"b".repeat(40)}`,
    spender: `0x${"c".repeat(40)}`, startBlock: 1,
  };
  expect(businessSchema.parse(base)).toMatchObject({ version: 1, ended: null });
  expect(businessSchema.parse({ ...base, version: 2, ended: "defaulted", stats: { delivered: 4, rejected: 1, uniqueBuyers: 3 } }))
    .toMatchObject({ version: 2, ended: "defaulted", stats: { delivered: 4, rejected: 1, uniqueBuyers: 3 } });
  expect(() => businessSchema.parse({ ...base, version: 3 })).toThrow();
});

test("an order in review carries its review end; a rejection its refund", () => {
  const base = {
    vault: `0x${"a".repeat(40)}`, orderId: "5", buyer: `0x${"b".repeat(40)}`, serviceId: 0, price: "250000",
    requestRef: `0x${"7".repeat(64)}`, deadline: 1795549723, placedTx: `0x${"f".repeat(64)}`, placedBlock: 1, envelopeHash: null,
  };
  const review = orderSchema.parse({ ...base, status: "in_review", reviewEnds: 1_900_000_000, refund: null });
  expect(review.reviewEnds).toEqual(new Date(1_900_000_000_000));
  expect(orderSchema.parse({ ...base, status: "rejected", reviewEnds: 1, refund: "150000" }).refund).toBe(150000n);
  expect(orderSchema.parse({ ...base, status: "delivered" })).toMatchObject({ reviewEnds: null, refund: null });
});
```

In `apps/fe/src/test/modules/market/api/market.api.test.ts`: add `readVaultV1: (address: string, functionName: string, args?: unknown[]) => readContract({ address, functionName, args, v1: true }),` to the `@/lib/chain` mock; add `version: 2` to `wire(...)`; extend `VAULT_VALUES` with `activatedAt: 1_800_000_000n, bondHeld: 5_000_000n, swept: 0n, uniqueBuyers: 3n` and give `loan` nine values (append `86_400n * 55n, 86_400n, 3` after the installment). Then append:

```ts
test("the market lists only v2 vaults", async () => {
  get.mockImplementation(async (path: string) => ({ data: path === "/v1/businesses" ? [{ ...wire("old", "0x1"), version: 1 }, wire("new", "0x2")] : [] }));
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => VAULT_VALUES[functionName]);
  const rows = await getMarket();
  expect(rows.map((r) => r.business.slug)).toEqual(["new"]);
});

test("a v2 snapshot carries the bond, the maturity date and unique buyers", async () => {
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => VAULT_VALUES[functionName]);
  const v = await readVaultSnapshot("0x2", 2);
  expect(v).toMatchObject({ version: 2, bondHeld: 5_000_000n, swept: 0n, uniqueBuyers: 3 });
  expect(v.maturityAt).toEqual(new Date((1_800_000_000 + 86_400 * 55) * 1000));
});

test("a v1 snapshot reads loan() with the v1 ABI and has no bond", async () => {
  const v1Loan = [50_000_000n, 55_000_000n, 1_900_000_000n, 86_400n, 86_400n, 1_000_000n];
  readContract.mockImplementation(async ({ functionName, v1 }: { functionName: string; v1?: boolean }) =>
    functionName === "loan" ? (v1 ? v1Loan : Promise.reject(new Error("v2 loan() on a v1 vault"))) : VAULT_VALUES[functionName]);
  const v = await readVaultSnapshot("0x1", 1);
  expect(v).toMatchObject({ version: 1, bondHeld: 0n, swept: 0n, uniqueBuyers: null, maturityAt: null, target: 50_000_000n });
});
```

Append to `apps/fe/src/test/modules/inbox/lib/inboxOrders.test.ts`:

```ts
test("v2 totals: a report in review is ready but not yet spent; a rejection returns its refund", () => {
  const totals = inboxTotals([
    { status: "in_review", price: 250_000n },
    { status: "settled", price: 250_000n },
    { status: "rejected", price: 250_000n, refund: 200_000n },
    { status: "declined", price: 250_000n, refund: 250_000n },
  ]);
  expect(totals).toEqual({ ready: 3, waiting: 0, spent: 300_000n, refunded: 450_000n });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run (in `apps/fe/`): `bun run test -- src/test/lib src/test/components/shared src/test/modules/market/api src/test/modules/inbox/lib`
Expected: failures: `Failed to resolve import "@/lib/orderStatus"`, `Unknown vault state 5`, missing `version` on the parsed business, and the market tests.

- [ ] **Step 3: Implement**

Create `apps/fe/src/lib/orderStatus.ts`:

```ts
import type { Order } from "@/lib/schemas";

type Status = Order["status"];

/** A report was delivered: v1 "delivered", or v2 "in_review", "settled" and "rejected". */
export const hasReport = (s: Status): boolean => s === "delivered" || s === "in_review" || s === "settled" || s === "rejected";

/** The buyer kept the report and the sale was split: v1 "delivered" or v2 "settled". */
export const isSettledSale = (s: Status): boolean => s === "delivered" || s === "settled";
```

In `apps/fe/src/lib/schemas.ts`:

```ts
const statsSchema = z.object({ delivered: z.number().int(), rejected: z.number().int(), uniqueBuyers: z.number().int() });

export const businessSchema = z.object({
  slug: z.string(),
  vault: hex,
  name: z.string(),
  tagline: z.string(),
  services: jsonText(z.array(serviceSchema)),
  operator: hex,
  spender: hex,
  startBlock: z.number().int(),
  /** v1 vaults stay readable for old orders and positions; Market, lending and buying use v2 only. */
  version: z.union([z.literal(1), z.literal(2)]).default(1),
  ended: z.enum(["defaulted", "closed"]).nullable().default(null),
  /** Counted by the backend from vault events; absent from an older backend. */
  stats: statsSchema.optional(),
});
export type Business = z.infer<typeof businessSchema>;

export const orderStatus = z.enum(["open", "claimed", "delivered", "in_review", "settled", "rejected", "declined", "reclaimed"]);
```

and add to `orderSchema` after `envelopeHash`:

```ts
  /** The end of the buyer's review (v2 deliveries only). */
  reviewEnds: z.number().int().nullable().default(null).transform((s) => (s === null ? null : new Date(s * 1000))),
  /** What a rejection returned to the buyer. */
  refund: units.nullable().default(null),
```

Replace `apps/fe/src/lib/vaultState.ts` with:

```ts
export type VaultStateName = "Raising" | "Active" | "Trapped" | "Repaid" | "Refunded" | "Defaulted" | "Closed";
const NAMES: VaultStateName[] = ["Raising", "Active", "Trapped", "Repaid", "Refunded", "Defaulted", "Closed"];

/** Maps the chain state number to its name. An unknown number is an error, never a guess. */
export const vaultStateName = (n: number): VaultStateName => {
  const name = NAMES[n];
  if (!name) throw new Error(`Unknown vault state ${n}`);
  return name;
};

/** The loan ended by a default or a Close order: nothing new is sold or lent, lenders claim what was swept. */
export const isEnded = (s: VaultStateName): boolean => s === "Defaulted" || s === "Closed";
```

In `apps/fe/src/components/shared/StateBadge.tsx` import `Archive` and `OctagonX` from `lucide-react` and add to `LOOK`:

```ts
  Defaulted: { label: "Defaulted", icon: OctagonX, className: "bg-danger-soft text-danger" },
  Closed: { label: "Closed", icon: Archive, className: "bg-surface-muted text-text-secondary" },
```

In `apps/fe/src/components/shared/OrderStatusBadge.tsx` add to `LOOK` (the comment gains "Badge/Danger (Rejected)"):

```ts
  in_review: { label: "In review", className: "bg-info-soft text-info" },
  settled: { label: "Delivered", className: "bg-success-soft text-success" },
  rejected: { label: "Rejected", className: "bg-danger-soft text-danger" },
```

In `apps/fe/src/lib/chain.ts` add:

```ts
import { LOAN_VAULT_V1_ABI } from "@qredit/qore/abis-v1";

type VaultV1Reader = ContractFunctionName<typeof LOAN_VAULT_V1_ABI, "view" | "pure">;

/** Reads a v1 vault where its ABI differs from v2 (`loan`, `books`, `orders`). The same single cast as `readVault`. */
export const readVaultV1 = <F extends VaultV1Reader>(
  address: Address,
  functionName: F,
  args?: ContractFunctionArgs<typeof LOAN_VAULT_V1_ABI, "view" | "pure", F>,
): Promise<ReadContractReturnType<typeof LOAN_VAULT_V1_ABI, F>> =>
  publicClient.readContract({ address, abi: LOAN_VAULT_V1_ABI, functionName, args } as never) as Promise<
    ReadContractReturnType<typeof LOAN_VAULT_V1_ABI, F>
  >;
```

In `apps/fe/src/modules/market/schemas/vault.schema.ts` add to `VaultSnapshot` (import `type VaultVersion` from `@qredit/qore/abi`):

```ts
  version: VaultVersion;
  /** The owner's bond still in the vault; 0 for v1 vaults and once it was returned or swept. */
  bondHeld: bigint;
  /** What an ended loan moved to lenders outside the schedule. */
  swept: bigint;
  /** First-time buyers counted by the vault; null for v1 vaults, which do not count them. */
  uniqueBuyers: number | null;
  /** Activation plus maturity; null before activation and for v1 vaults. */
  maturityAt: Date | null;
```

In `apps/fe/src/modules/market/api/market.api.ts` replace `readVaultSnapshot` and the first line of `getMarket`:

```ts
/** Reads the loan of one vault from the chain, with the ABI of its version. An unknown state number rejects. */
export async function readVaultSnapshot(vault: Hex, version: VaultVersion = 2): Promise<VaultSnapshot> {
  const [state, raised, repaid, paused, lenderBps, activatedAt] = await Promise.all([
    readVault(vault, "state"),
    readVault(vault, "raised"),
    readVault(vault, "repaid"),
    readVault(vault, "paused"),
    readVault(vault, "lenderBps"),
    readVault(vault, "activatedAt"),
  ]);
  const common = { state: vaultStateName(Number(state)), raised, repaid, paused, lenderBps: Number(lenderBps) };
  if (version === 1) {
    // loan() of v1 returns target, totalOwed, raiseDeadline, period, grace, installment.
    const [target, totalOwed, raiseDeadline, period, , installment] = await readVaultV1(vault, "loan");
    return {
      ...common, version: 1, target, totalOwed, installment, period, raiseDeadline: new Date(Number(raiseDeadline) * 1000),
      bondHeld: 0n, swept: 0n, uniqueBuyers: null, maturityAt: null,
    };
  }
  const [loan, bondHeld, swept, uniqueBuyers] = await Promise.all([
    readVault(vault, "loan"),
    readVault(vault, "bondHeld"),
    readVault(vault, "swept"),
    readVault(vault, "uniqueBuyers"),
  ]);
  // v2 loan() adds maturity, maturityGrace and defaultAfterMissed after the installment.
  const [target, totalOwed, raiseDeadline, period, , installment, maturity] = loan;
  return {
    ...common, version: 2, target, totalOwed, installment, period, raiseDeadline: new Date(Number(raiseDeadline) * 1000),
    bondHeld, swept, uniqueBuyers: Number(uniqueBuyers),
    maturityAt: activatedAt > 0n ? new Date(Number(activatedAt + maturity) * 1000) : null,
  };
}
```

```ts
  // v1 vaults stay on chain for old orders and positions; the Market lists only v2.
  const businesses = (await getBusinesses()).filter((b) => b.version === 2);
```

and in `getMarket` call `readVaultSnapshot(b.vault, b.version)`; `countDelivered` counts `hasReport(o.status)` instead of `o.status === "delivered"` (import from `@/lib/orderStatus`). Import `readVaultV1` from `@/lib/chain` and `type VaultVersion` from `@qredit/qore/abi`.

In `apps/fe/src/modules/market/api/market.keys.ts` add `businesses: ["market", "businesses"] as const,`; in `useMarketQuery.ts` add

```ts
/** Every business, v1 and v2: the Inbox and lending positions still read v1 vaults. */
export const useBusinessesQuery = () =>
  useQuery({ queryKey: marketKeys.businesses, queryFn: getBusinesses, refetchInterval: REFRESH_MS });
```

change `useVaultQuery` to `(vault: \`0x${string}\`, version: 1 | 2 = 2)` with `queryFn: () => readVaultSnapshot(vault, version)`, and export `useBusinessesQuery` from `apps/fe/src/modules/market/index.ts`.

In `apps/fe/src/modules/inbox/components/InboxPage.tsx` and `apps/fe/src/modules/lend/components/PositionsPage.tsx` replace

```ts
  const market = useMarketQuery();
  const businesses = market.data?.map((row) => row.business);
```

with

```ts
  // v1 vaults stay listed here: old orders and positions must still open.
  const market = useBusinessesQuery();
  const businesses = market.data;
```

(import `useBusinessesQuery` instead of `useMarketQuery`; the `market.isError` and `market.refetch()` uses stay valid). In `apps/fe/src/modules/lend/api/lend.api.ts` `readPositions` calls `readVaultSnapshot(business.vault, business.version)`.

In `apps/fe/src/modules/inbox/lib/inboxOrders.ts` replace `InboxTotals` and `inboxTotals`:

```ts
export type InboxTotals = {
  /** Delivered reports, in either vault version. The app cannot tell which were opened already, so every one counts. */
  ready: number;
  /** Orders the agent has not delivered, declined or lost yet. */
  waiting: number;
  /** What the buyer paid for reports it kept, plus what a rejection or a decline kept as supplier cost. */
  spent: bigint;
  /** What came back to the buyer: reclaims, declines and rejections (the refund when it is known, else the price). */
  refunded: bigint;
};

export function inboxTotals(orders: (Pick<Order, "status" | "price"> & { refund?: bigint | null })[]): InboxTotals {
  const totals: InboxTotals = { ready: 0, waiting: 0, spent: 0n, refunded: 0n };
  for (const o of orders) {
    if (hasReport(o.status)) totals.ready += 1;
    if (isSettledSale(o.status)) totals.spent += o.price;
    else if (o.status === "open" || o.status === "claimed") totals.waiting += 1;
    else if (o.status === "rejected" || o.status === "declined" || o.status === "reclaimed") {
      const back = o.refund ?? o.price;
      totals.refunded += back;
      totals.spent += o.price - back;
    }
    // in_review: the price is still in escrow, neither spent nor returned.
  }
  return totals;
}
```

In `apps/fe/src/modules/inbox/components/InboxList.tsx` add to `ICONS` `in_review: Mail, settled: Mail, rejected: MailX,` and replace both `o.status === "delivered"` / `order.status === "delivered"` checks with `hasReport(...)`. In `apps/fe/src/modules/inbox/components/ReportPage.tsx` replace `order?.status === "delivered"` with `order ? hasReport(order.status) : false` and `if (order.status === "delivered") card = null;` with `if (hasReport(order.status)) card = null;`.

- [ ] **Step 4: Run the tests and see them pass**

Run (in `apps/fe/`): `bun run test && bun run typecheck && bun run lint`
Expected: all tests pass (including the new and changed ones above), no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add apps/fe/src/lib apps/fe/src/components/shared/StateBadge.tsx apps/fe/src/components/shared/OrderStatusBadge.tsx apps/fe/src/modules/market apps/fe/src/modules/inbox apps/fe/src/modules/lend apps/fe/src/test
git commit -m "feat(fe): v2 states, order statuses and v1 reads" -m "Spec sections 2, 10 and 11: the app knows Defaulted and Closed, the review statuses and the business version; the Market lists only v2 vaults while the Inbox and lending positions read v1 and v2 (v1 loan() through the frozen ABI). Tests: vitest (all), typecheck and lint in apps/fe." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Web app: buyer review in the Inbox and on the Report page

**Files:**
- Create: `apps/fe/src/modules/inbox/components/ReviewBadge.tsx`, `apps/fe/src/modules/inbox/components/ReviewActions.tsx`, `apps/fe/src/test/modules/inbox/components/ReviewActions.test.tsx`
- Modify: `apps/fe/src/modules/inbox/api/inbox.api.ts`, `apps/fe/src/modules/inbox/api/useInbox.ts`, `apps/fe/src/modules/inbox/api/inbox.keys.ts`, `apps/fe/src/modules/inbox/lib/inboxOrders.ts`, `apps/fe/src/modules/inbox/components/InboxList.tsx`, `apps/fe/src/modules/inbox/components/ReportPage.tsx`
- Test: `apps/fe/src/test/modules/inbox/api/inbox.api.test.ts`, `apps/fe/src/test/modules/inbox/lib/inboxOrders.test.ts`

**Interfaces:**
- Consumes: Task 14 `Order.reviewEnds`, `Order.refund`, `hasReport`; Task 8 `VAULT_EVENTS`, `VAULT_EVENTS_V1`, `LOAN_VAULT_ABI` (`accept`, `reject`, `supplierCost`).
- Produces:
  - `readDelivery(vault: Hex, orderId: string, fromBlock?: number, deadline?: Date, version?: VaultVersion): Promise<Delivery>` (picks `Delivered` of the version)
  - `readRejectRefund(vault: Hex, orderId: string, price: bigint): Promise<bigint>`
  - `accept(session: WalletSession, vault: Hex, orderId: string): Promise<Hex>`, `reject(session: WalletSession, vault: Hex, orderId: string): Promise<Hex>`
  - `readMyOrders` fills `refund` for v2 declined orders from `supplierCost`
  - `inReview(o: Pick<Order, "status" | "reviewEnds">, now?: Date | number): boolean`
  - `useRejectRefundQuery(vault: Hex, orderId: string, price: bigint, enabled: boolean)`; `useInboxActions()` gains `accept` and `reject`
  - `<ReviewBadge reviewEnds now />`, `<ReviewActions order business />`

- [ ] **Step 1: Write the failing tests**

Append to `apps/fe/src/test/modules/inbox/lib/inboxOrders.test.ts` (import `inReview`):

```ts
test("an order is in review until its review ends", () => {
  expect(inReview({ status: "in_review", reviewEnds: future }, NOW)).toBe(true);
  expect(inReview({ status: "in_review", reviewEnds: new Date(NOW) }, NOW)).toBe(true);
  expect(inReview({ status: "in_review", reviewEnds: past }, NOW)).toBe(false);
  expect(inReview({ status: "settled", reviewEnds: future }, NOW)).toBe(false);
  expect(inReview({ status: "in_review", reviewEnds: null }, NOW)).toBe(false);
});
```

In `apps/fe/src/test/modules/inbox/api/inbox.api.test.ts` add a `readContract` mock to the `@/lib/chain` mock (`readVault: (address: string, functionName: string, args?: unknown[]) => readContract({ address, functionName, args })`, with `const readContract = vi.fn();` at the top), import `accept`, `readRejectRefund`, `reject`, and append:

```ts
describe("buyer review", () => {
  test("the refund of a rejection is the price less the supplier cost", async () => {
    readContract.mockResolvedValueOnce(50_000n);
    expect(await readRejectRefund(VAULT, "7", 250_000n)).toBe(200_000n);
    expect(readContract).toHaveBeenCalledWith({ address: VAULT, functionName: "supplierCost", args: [7n] });
    readContract.mockResolvedValueOnce(900_000n); // never below zero
    expect(await readRejectRefund(VAULT, "7", 250_000n)).toBe(0n);
  });

  test("accept and reject send the vault call for the order", async () => {
    const sent: unknown[] = [];
    signerFor.mockReturnValue({ address: ME, send: async (to: string, data: `0x${string}`) => { sent.push(decodeFunctionData({ abi: LOAN_VAULT_ABI, data })); return "0xhash"; } });
    ensureWindowFor.mockResolvedValue(null);
    const session = { kind: "test" } as unknown as WalletSession;
    expect(await accept(session, VAULT, "7")).toBe("0xhash");
    expect(await reject(session, VAULT, "8")).toBe("0xhash");
    expect(sent).toEqual([{ functionName: "accept", args: [7n] }, { functionName: "reject", args: [8n] }]);
  });
});
```

(follow the file's existing `reclaim` test for how the session and signer are faked; if that test builds the session differently, use the same construction here.)

Create `apps/fe/src/test/modules/inbox/components/ReviewActions.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

const accept = vi.fn();
const reject = vi.fn();
const refund = vi.fn();
vi.mock("@/modules/inbox/api/useInbox", () => ({
  useInboxActions: () => ({ accept, reject }),
  useRejectRefundQuery: (_v: string, _o: string, _p: bigint, enabled: boolean) => (enabled ? { data: refund(), isError: false, isFetching: false } : { data: undefined, isError: false, isFetching: false }),
}));

import { ReviewActions } from "@/modules/inbox/components/ReviewActions";

beforeEach(() => vi.resetAllMocks());

const order = { vault: "0x1" as const, orderId: "7", price: 250_000n };
const business = { name: "Counterparty Check" };

test("Reject asks first and shows the refund", async () => {
  refund.mockReturnValue(200_000n);
  render(<ReviewActions order={order} business={business} />);
  await userEvent.click(screen.getByRole("button", { name: "Reject" }));
  expect(await screen.findByText(/You will get 0\.20 fUSD back/)).toBeInTheDocument();
  expect(screen.getByText(/keeps 0\.05 fUSD/)).toBeInTheDocument();
  expect(reject).not.toHaveBeenCalled();
});

test("Accept asks first and says the sale is final", async () => {
  render(<ReviewActions order={order} business={business} />);
  await userEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByText(/This cannot be undone/)).toBeInTheDocument();
  expect(accept).not.toHaveBeenCalled();
});
```

(The amounts follow `formatFusd`; if its output for 200 000 units differs from `0.20 fUSD`, match the text `formatFusd(200_000n)` returns, as `src/test/lib/format.test.ts` shows.)

- [ ] **Step 2: Run the tests and see them fail**

Run (in `apps/fe/`): `bun run test -- src/test/modules/inbox`
Expected: failures: `inReview is not a function`, `readRejectRefund is not a function`, `Failed to resolve import "@/modules/inbox/components/ReviewActions"`.

- [ ] **Step 3: Implement**

In `apps/fe/src/modules/inbox/lib/inboxOrders.ts` add:

```ts
/** The buyer may still accept or reject: delivered by a v2 vault and the review has not ended. */
export const inReview = (o: Pick<Order, "status" | "reviewEnds">, now: Date | number = Date.now()): boolean =>
  o.status === "in_review" && o.reviewEnds !== null && +now <= +o.reviewEnds;
```

In `apps/fe/src/modules/inbox/api/inbox.api.ts`: import `VAULT_EVENTS, VAULT_EVENTS_V1, type VaultVersion` from `@qredit/qore/abi` and `readVault` from `@/lib/chain`; replace the `DELIVERED` constant with

```ts
/** The Delivered event of each vault version: v1 carries the split, v2 the end of the review. */
const deliveredEvent = (version: VaultVersion) =>
  version === 1 ? getAbiItem({ abi: VAULT_EVENTS_V1, name: "Delivered" }) : getAbiItem({ abi: VAULT_EVENTS, name: "Delivered" });
```

give `findDeliveredLog` and `readDelivery` a last parameter `version: VaultVersion = 2`, pass it through, and use `event: deliveredEvent(version) as never` in `getLogs`; `openMyReport` takes `version: VaultVersion = 2` and passes it. Replace `readMyOrders` and add the review calls:

```ts
/**
 * Orders placed by one buyer in every listed business, newest first. A v2 decline returns the price less the supplier
 * cost, which the backend does not know, so it is read from the vault. A vault that cannot be read fails the whole read.
 */
export async function readMyOrders(evm: Hex, businesses: Business[]): Promise<InboxOrder[]> {
  const me = evm.toLowerCase();
  const perBusiness = await Promise.all(
    businesses.map(async (business) => {
      const mine = (await getOrders(business.vault)).filter((o) => o.buyer.toLowerCase() === me);
      return Promise.all(
        mine.map(async (o): Promise<InboxOrder> =>
          business.version === 2 && o.status === "declined" && o.refund === null
            ? { ...o, business, refund: await readRejectRefund(business.vault, o.orderId, o.price) }
            : { ...o, business },
        ),
      );
    }),
  );
  return perBusiness.flat().sort((a, b) => b.placedBlock - a.placedBlock);
}

/** What the buyer gets back from a rejection now: the price less what the agent already paid suppliers for the order. */
export async function readRejectRefund(vault: Hex, orderId: string, price: bigint): Promise<bigint> {
  const cost = await readVault(vault, "supplierCost", [BigInt(orderId)]);
  return price - (cost < price ? cost : price);
}

const reviewCall = (session: WalletSession, vault: Hex, orderId: string, functionName: "accept" | "reject"): Promise<Hex> =>
  act(session, [vault], (signer) => signer.send(vault, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName, args: [BigInt(orderId)] })));

/** The buyer keeps the report: the sale settles at once and lenders are repaid first. */
export const accept = (session: WalletSession, vault: Hex, orderId: string) => reviewCall(session, vault, orderId, "accept");

/** The buyer rejects the report during its review and gets the price back less the supplier cost. */
export const reject = (session: WalletSession, vault: Hex, orderId: string) => reviewCall(session, vault, orderId, "reject");
```

In `apps/fe/src/modules/inbox/api/inbox.keys.ts` add `refund: (vault: string, orderId: string) => ["inbox", "refund", vault, orderId] as const,`. In `apps/fe/src/modules/inbox/api/useInbox.ts`: `useDeliveryQuery` gains a `version: 1 | 2` parameter passed to `readDelivery`; add

```ts
/** The refund a rejection would give now; read when the buyer opens the Reject dialog. */
export const useRejectRefundQuery = (vault: Hex, orderId: string, price: bigint, enabled: boolean) =>
  useQuery({ queryKey: inboxKeys.refund(vault, orderId), queryFn: () => readRejectRefund(vault, orderId, price), enabled, staleTime: 0 });
```

and add to the object of `useInboxActions` (same refetches as `reclaim`):

```ts
      accept: async (vault: Hex, orderId: string) => {
        const hash = await accept(session, vault, orderId);
        void client.invalidateQueries({ queryKey: inboxKeys.all });
        void client.invalidateQueries({ queryKey: marketKeys.all });
        return hash;
      },
      reject: async (vault: Hex, orderId: string) => {
        const hash = await reject(session, vault, orderId);
        void client.invalidateQueries({ queryKey: inboxKeys.all });
        void client.invalidateQueries({ queryKey: marketKeys.all });
        void client.invalidateQueries({ queryKey: walletKeys.all });
        return hash;
      },
```

Create `apps/fe/src/modules/inbox/components/ReviewBadge.tsx`:

```tsx
import { formatRelative } from "@/lib/format";

/** In review with the time left (Badge/Info). After the end it waits for the settlement, which anyone may send. */
export function ReviewBadge({ reviewEnds, now }: { reviewEnds: Date | null; now: Date }) {
  const open = reviewEnds !== null && +now <= +reviewEnds;
  return (
    <span className="inline-flex items-center rounded-full bg-info-soft px-2.5 py-1.5 text-[13px] leading-none font-medium text-info tabular-nums">
      {open ? `In review, ends ${formatRelative(reviewEnds, now)}` : "Review ended"}
    </span>
  );
}
```

Create `apps/fe/src/modules/inbox/components/ReviewActions.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChainAction } from "@/components/shared/ChainAction";
import { Notice } from "@/components/shared/Notice";
import { Button } from "@/components/ui/button";
import { formatFusd } from "@/lib/format";
import type { Business, Order } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { useInboxActions, useRejectRefundQuery } from "@/modules/inbox/api/useInbox";

type Props = {
  order: Pick<Order, "vault" | "orderId" | "price">;
  business: Pick<Business, "name">;
  size?: "sm" | "lg";
  className?: string;
};

const NEXT = { text: "Check your inbox before trying again.", label: "Open the inbox", href: "/inbox" };

/**
 * Accept or Reject a delivered report during its review. Both ask first through ChainAction (ConfirmDialog); Reject
 * reads the refund from the vault when it is opened and shows it before anything is sent.
 */
export function ReviewActions({ order, business, size = "sm", className }: Props) {
  const [open, setOpen] = useState<"accept" | "reject" | null>(null);
  const actions = useInboxActions();
  const refund = useRejectRefundQuery(order.vault, order.orderId, order.price, open === "reject");
  const price = formatFusd(order.price);
  const back = refund.data;
  const toggle = (which: "accept" | "reject") => (next: boolean) => setOpen(next ? which : null);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex gap-2">
        <Button type="button" size={size} onClick={() => setOpen("accept")}>
          Accept
        </Button>
        <Button type="button" size={size} variant="secondary" onClick={() => setOpen("reject")} disabled={open === "reject" && refund.isFetching}>
          Reject
        </Button>
      </div>
      {open === "reject" && refund.isError && <Notice tone="danger">The refund could not be read. Nothing was sent. Please try again.</Notice>}
      <ChainAction
        open={open === "accept"}
        onOpenChange={toggle("accept")}
        title={`Accept the report of order ${order.orderId}`}
        body={`The ${price} you paid is released to ${business.name}, and lenders are repaid first. This cannot be undone.`}
        confirmLabel="Accept"
        pendingLabel="Accepting the report"
        successTitle="Report accepted"
        successText={`${business.name} has been paid for this report.`}
        nextStep={NEXT}
        run={() => actions.accept(order.vault, order.orderId)}
      />
      {back !== undefined && (
        <ChainAction
          open={open === "reject"}
          onOpenChange={toggle("reject")}
          title={`Reject the report of order ${order.orderId}`}
          body={`You will get ${formatFusd(back)} back. ${business.name} keeps ${formatFusd(order.price - back)}, which it already paid its suppliers for this order. This cannot be undone.`}
          confirmLabel={`Reject and get ${formatFusd(back)} back`}
          pendingLabel="Rejecting the report"
          successTitle={`Rejected, ${formatFusd(back)} returned`}
          successText="The refund has been paid to your wallet."
          nextStep={NEXT}
          run={() => actions.reject(order.vault, order.orderId)}
        />
      )}
    </div>
  );
}
```

In `apps/fe/src/modules/inbox/components/InboxList.tsx`, `Status` shows the review for a v2 delivery: before the `late` check add `if (order.status === "in_review") return <ReviewBadge reviewEnds={order.reviewEnds} now={now} />;` and pass `now` into `Status` (`<Status order={o} late={late} now={now} />`, signature `{ order: InboxOrder; late: boolean; now: Date }`). The list keeps one action per row ("Open report"); Accept and Reject sit on the Report page, where the buyer reads the report before judging it.

In `apps/fe/src/modules/inbox/components/ReportPage.tsx`: pass `business.version` (from the loaded context) to `useDeliveryQuery(..., loaded?.business.version ?? 2)`; add

```tsx
/** The buyer's review of a v2 delivery: Accept or Reject until the end, then a note that the sale settles. */
function ReviewPanel({ order, business }: Loaded) {
  const now = useNow();
  const readiness = useWalletReadiness();
  if (order.status === "rejected") {
    return <Notice tone="info">You rejected this report{order.refund !== null ? `, and ${formatFusd(order.refund)} was returned to your wallet` : ""}.</Notice>;
  }
  if (order.status !== "in_review" || order.reviewEnds === null) return null;
  if (!inReview(order, now)) {
    return <Notice tone="info">The review ended without a rejection, so the sale settles and {business.name} is paid.</Notice>;
  }
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-surface p-5 md:flex-row md:items-center md:justify-between md:p-6">
      <div className="flex flex-col gap-1">
        <ReviewBadge reviewEnds={order.reviewEnds} now={now} />
        <p className="text-sm text-text-secondary">
          You can accept or reject this report until {formatDateTime(order.reviewEnds)}. If you do neither, the sale settles after that.
        </p>
      </div>
      {readiness.state === "ready" ? <ReviewActions order={order} business={business} size="lg" className="md:items-end" /> : null}
    </section>
  );
}
```

and render `<ReviewPanel order={order} business={business} />` between `<Checks …/>` and `{card}` in the final return (import `ReviewActions`, `ReviewBadge`, `inReview`).

- [ ] **Step 4: Run the tests and see them pass**

Run (in `apps/fe/`): `bun run test && bun run typecheck && bun run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/fe/src/modules/inbox apps/fe/src/test/modules/inbox
git commit -m "feat(fe): accept or reject a report during its review" -m "Spec sections 5 and 11: the Inbox shows In review with the time left, and the Report page offers Accept and Reject (both confirmed; Reject shows the refund, price less supplier cost, read from the vault). v1 orders keep opening through the v1 Delivered event. Tests: vitest (all), typecheck and lint in apps/fe." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: Web app: lending positions after a default or a Close, v1 positions kept

**Files:**
- Modify: `apps/fe/src/modules/lend/api/lend.api.ts`, `apps/fe/src/modules/lend/components/PositionList.tsx`, `apps/fe/src/modules/lend/components/ClaimButton.tsx`
- Test: `apps/fe/src/test/modules/lend/api/lend.api.test.ts`, `apps/fe/src/test/modules/lend/components/PositionsPage.test.tsx`

**Interfaces:**
- Consumes: Task 14 `VaultSnapshot.swept`, `VaultSnapshot.version`, `isEnded`, `StateBadge` (Defaulted, Closed).
- Produces: `Position.fromSweep: bigint` (this lender's pro-rata part of `swept`, rounded down; `0n` for v1); `sweepShare(deposit: bigint, swept: bigint, raised: bigint): bigint`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/fe/src/test/modules/lend/api/lend.api.test.ts` (import `sweepShare`):

```ts
test("the sweep is shared pro rata and rounded down", () => {
  expect(sweepShare(60_000_000n, 10_000_000n, 100_000_000n)).toBe(6_000_000n);
  expect(sweepShare(1n, 2n, 3n)).toBe(0n);
  expect(sweepShare(5n, 0n, 0n)).toBe(0n);
});
```

and, in the existing `readPositions` test, give the mocked snapshot `swept: 10_000_000n, raised: 100_000_000n, version: 2` and expect `fromSweep` on the position (`deposit * swept / raised`); add a second case where the business has `version: 1` and expect `readVaultSnapshot` to have been called with `(vault, 1)` and `fromSweep: 0n`.

Append to `apps/fe/src/test/modules/lend/components/PositionsPage.test.tsx` (use the file's existing position factory and render helper):

```tsx
test("a defaulted position shows the badge and what the sweep added to Claim", async () => {
  // position(...) is the file's factory; override the fields that matter here.
  renderPositions([position({ vault: { state: "Defaulted", swept: 10_000_000n }, claimable: 7_000_000n, fromSweep: 6_000_000n })]);
  expect(await screen.findByText("Defaulted")).toBeInTheDocument();
  expect(screen.getByText("Includes 6.00 from the ended loan")).toBeInTheDocument();
});

test("a v1 position is labelled as an earlier vault", async () => {
  renderPositions([position({ business: { version: 1 } })]);
  expect(await screen.findByText("Earlier vault")).toBeInTheDocument();
});
```

(If the file has no `position`/`renderPositions` helpers, add them at the top: `position(over)` returns a `Position` built from one business and one snapshot with the given overrides; `renderPositions(list)` mocks `usePositionsQuery` to return `{ data: list }` and renders `PositionsPage` inside the wallet test helper `src/test/helpers/wallet.tsx` with a ready test wallet.)

- [ ] **Step 2: Run the tests and see them fail**

Run (in `apps/fe/`): `bun run test -- src/test/modules/lend`
Expected: failures: `sweepShare is not a function`, `Unable to find an element with the text: Includes 6.00 from the ended loan`, `Earlier vault`.

- [ ] **Step 3: Implement**

In `apps/fe/src/modules/lend/api/lend.api.ts`:

```ts
/** What a lender holds in one vault. Amounts are fUSD units (6 decimals). */
export type Position = {
  business: Business;
  vault: VaultSnapshot;
  deposit: bigint;
  claimable: bigint;
  claimed: bigint;
  /** This lender's part of what an ended loan moved to lenders (included in `claimable` until claimed). */
  fromSweep: bigint;
};

/** The pro-rata part of the sweep, rounded down like the vault's accumulator. */
export const sweepShare = (deposit: bigint, swept: bigint, raised: bigint): bigint => (raised > 0n ? (deposit * swept) / raised : 0n);
```

and in `readPositions` read `readVaultSnapshot(business.vault, business.version)` and return `{ business, vault, deposit, claimable, claimed, fromSweep: sweepShare(deposit, vault.swept, vault.raised) }`.

In `apps/fe/src/modules/lend/components/PositionList.tsx` replace the Claimable fact and the name block:

```tsx
            <div className="col-span-2 flex min-w-0 items-center gap-3 max-md:order-1 md:col-span-1">
              <BusinessMark slug={p.business.slug} size={40} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-medium text-text-primary">{p.business.name}</span>
                <span className="truncate text-[13px] text-text-secondary">
                  {p.business.version === 1 ? "Earlier vault" : p.business.tagline}
                </span>
              </div>
            </div>
            <Fact label="Lent" units={p.deposit} className="md:col-start-2" />
            <Fact label="Repaid to you" units={p.claimed} />
            <div className="flex flex-col gap-0.5 max-md:order-3 md:text-right">
              <span className="text-xs text-text-tertiary md:sr-only">Claimable</span>
              <span className="text-[15px] text-text-primary tabular-nums">{formatFusd(p.claimable, { unit: false })}</span>
              {isEnded(p.vault.state) && p.fromSweep > 0n && p.claimable > 0n && (
                <span className="text-xs text-text-tertiary tabular-nums">Includes {formatFusd(p.fromSweep, { unit: false })} from the ended loan</span>
              )}
            </div>
```

(import `isEnded` from `@/lib/vaultState`). The badge shows Defaulted and Closed through `StateBadge` (Task 14).

In `apps/fe/src/modules/lend/components/ClaimButton.tsx` the body becomes:

```tsx
        body={
          isEnded(position.vault.state)
            ? `The loan of ${name} has ended. What it repaid and what it moved to lenders when it ended will be paid to your wallet. Nothing else moves.`
            : `The repayments of ${name} that have arrived will be paid to your wallet. Nothing else moves.`
        }
```

- [ ] **Step 4: Run the tests and see them pass**

Run (in `apps/fe/`): `bun run test && bun run typecheck && bun run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/fe/src/modules/lend apps/fe/src/test/modules/lend
git commit -m "feat(fe): positions after a default or a Close" -m "Spec sections 6, 10 and 11: a position in a Defaulted or Closed vault shows its badge and what the sweep added to Claim; v1 positions stay listed as an earlier vault so v1 lenders can still refund or claim. Tests: vitest (all), typecheck and lint in apps/fe." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: Web app: owner console with Close, RotateAgent and the owner claim rule

**Files:**
- Modify: `apps/fe/src/modules/owner/schemas/policyOrder.schema.ts`, `apps/fe/src/modules/owner/lib/precheck.ts`, `apps/fe/src/modules/owner/lib/describe.ts`, `apps/fe/src/modules/owner/api/owner.api.ts`, `apps/fe/src/modules/owner/api/useOwner.ts`, `apps/fe/src/modules/owner/components/PolicyOrderForm.tsx`, `apps/fe/src/modules/owner/components/OrderSignature.tsx`, `apps/fe/src/modules/owner/components/OwnerPage.tsx`
- Create: `apps/fe/src/modules/owner/components/OwnerClaimCard.tsx`, `apps/fe/src/test/modules/owner/lib/describe.test.ts`
- Test: `apps/fe/src/test/modules/owner/schemas/policyOrder.schema.test.ts`, `apps/fe/src/test/modules/owner/lib/precheck.test.ts`, `apps/fe/src/test/modules/owner/api/owner.api.test.ts`

**Interfaces:**
- Consumes: Task 8 `LOAN_VAULT_ABI` (`claimOwner`, `ownerPending`, `expectedRepaid`, `spender`, `operator`); Task 14 `isEnded`.
- Produces:
  - `POLICY_KINDS` gains `"Close"` (8) and `"RotateAgent"` (9); `KindInfo` gains optional `operator`, `targetLabel`, `irreversible`
  - `policyOrderSchema` gains `operator: string`; `orderInput` puts `uint256(uint160(operator))` in `value` for `RotateAgent`
  - `Rules` gains `ownerPending: bigint`, `claimAhead: boolean`, `spender: Hex`, `operator: Hex`
  - `ENDED_SENTENCE`, `precheck` refuses every order of an ended vault and a Close outside Active or Trapped
  - `applyBody(order: PolicyOrder): string` (describe.ts)
  - `claimOwnerShare(session: WalletSession, vault: Hex): Promise<Hex>`; `useOwnerActions().claim(vault)`
  - `<OwnerClaimCard business rules />`

- [ ] **Step 1: Write the failing tests**

Append to `apps/fe/src/test/modules/owner/schemas/policyOrder.schema.test.ts`:

```ts
const NEW_SPENDER = "0x00000000000000000000000000000000000000c1";
const NEW_OPERATOR = "0x00000000000000000000000000000000000000c2";

test("Close and RotateAgent follow the contract's kind numbers", () => {
  expect(POLICY_KINDS.indexOf("Close")).toBe(8);
  expect(POLICY_KINDS.indexOf("RotateAgent")).toBe(9);
});

test("RotateAgent needs both new keys and carries the operator in value", () => {
  const missing = policyOrderSchema.safeParse({ kind: "RotateAgent", target: NEW_SPENDER, value: "", operator: "", expiryMinutes: "30" });
  expect(missing.success).toBe(false);
  const ok = policyOrderSchema.parse({ kind: "RotateAgent", target: NEW_SPENDER, value: "", operator: NEW_OPERATOR, expiryMinutes: "30" });
  expect(orderInput(ok)).toEqual({ kind: 9, target: NEW_SPENDER, value: BigInt(NEW_OPERATOR), expiryMinutes: 30 });
});

test("Close needs no address and no amount", () => {
  const v = policyOrderSchema.parse({ kind: "Close", target: "", value: "", operator: "", expiryMinutes: "30" });
  expect(orderInput(v)).toEqual({ kind: 8, target: ZERO_ADDRESS, value: 0n, expiryMinutes: 30 });
  expect(KIND_INFO.Close.irreversible).toBe(true);
});
```

(every existing `policyOrderSchema.parse({...})` in that file gains `operator: ""`.)

Append to `apps/fe/src/test/modules/owner/lib/precheck.test.ts` (the file's `rules` fixture gains `ownerPending: 0n, claimAhead: false, spender: "0x01", operator: "0x02"`):

```ts
test("an ended vault refuses every order", () => {
  for (const state of ["Defaulted", "Closed"] as const) {
    expect(precheck("Pause", null, { ...rules, state })).toBe(ENDED_SENTENCE);
    expect(precheck("RotateAgent", null, { ...rules, state })).toBe(ENDED_SENTENCE);
  }
});

test("Close only while the loan runs", () => {
  expect(precheck("Close", null, { ...rules, state: "Active" })).toBeNull();
  expect(precheck("Close", null, { ...rules, state: "Trapped" })).toBeNull();
  expect(precheck("Close", null, { ...rules, state: "Repaid" })).toBe("A repaid loan cannot be closed.");
  expect(precheck("Close", null, { ...rules, state: "Raising" })).toBe("The loan can be closed only once it is funded and running.");
});
```

Create `apps/fe/src/test/modules/owner/lib/describe.test.ts`:

```ts
import { expect, test } from "vitest";
import { applyBody, appliedTitle, orderSentence } from "@/modules/owner/lib/describe";

const order = (kind: number, target = "0x0000000000000000000000000000000000000000", value = 0n) =>
  ({ kind, target, value, nonce: 0n, expiry: 0n }) as const;

test("Close says it cannot be undone before it is applied", () => {
  expect(orderSentence(order(8))).toBe("Close the loan and move the operating funds, the owner share and the bond to lenders");
  expect(applyBody(order(8))).toContain("This cannot be undone");
  expect(appliedTitle(order(8))).toBe("The loan is closed");
});

test("RotateAgent names both new keys", () => {
  const o = order(9, "0x00000000000000000000000000000000000000c1", BigInt("0x00000000000000000000000000000000000000c2"));
  expect(orderSentence(o)).toBe("Replace the agent keys with spending key 0x0000…00c1 and operator key 0x0000…00c2");
  expect(applyBody(o)).not.toContain("cannot be undone");
  expect(appliedTitle(o)).toBe("The agent keys are replaced");
});
```

Append to `apps/fe/src/test/modules/owner/api/owner.api.test.ts` (its `@/lib/chain` mock already fakes `readVault` and `publicClient.getBlock`; add the values below to its read table):

```ts
test("the owner claim is allowed only one installment ahead", async () => {
  // Active, repaid 20, period 1 day; expectedRepaid(now + period) is read from the vault.
  setReads({ ownerPending: 3_000_000n, repaid: 20_000_000n, expectedRepaid: 20_000_000n, spender: "0x01", operator: "0x02" });
  expect((await readRules(VAULT)).claimAhead).toBe(true);
  setReads({ ownerPending: 3_000_000n, repaid: 19_000_000n, expectedRepaid: 20_000_000n, spender: "0x01", operator: "0x02" });
  expect((await readRules(VAULT)).claimAhead).toBe(false);
});
```

(`setReads` is the file's helper that sets the mocked `readVault` answers; if the file names it differently, use that helper. The block timestamp and `loan()` come from the existing fixture.)

- [ ] **Step 2: Run the tests and see them fail**

Run (in `apps/fe/`): `bun run test -- src/test/modules/owner`
Expected: failures for `Close`, `RotateAgent`, `ENDED_SENTENCE`, `applyBody` and `claimAhead`.

- [ ] **Step 3: Implement**

In `apps/fe/src/modules/owner/schemas/policyOrder.schema.ts`: append `"Close", "RotateAgent"` to `POLICY_KINDS`; extend `KindInfo` with

```ts
  /** The order names a second address: the new operator key (RotateAgent). */
  operator?: boolean;
  /** The label of the first address field; "Supplier address" when unset. */
  targetLabel?: string;
  /** Applying it cannot be undone. */
  irreversible?: boolean;
```

add to `KIND_INFO`

```ts
  Close: {
    label: "Close the loan",
    description: "Ends the loan now. The operating funds, the owner share and the bond go to lenders, and the business stops selling. This cannot be undone.",
    target: false,
    value: false,
    valueLabel: "",
    widening: false,
    irreversible: true,
  },
  RotateAgent: {
    label: "Replace the agent keys",
    description: "The vault accepts a new spending key and a new operator key. The old keys stop working at once.",
    target: true,
    targetLabel: "New spending key",
    operator: true,
    value: false,
    valueLabel: "",
    widening: false,
  },
```

append `"RotateAgent", "Close"` to `KIND_LIST` before the widening kinds (after `"RemoveSupplier"`); add `operator: z.string()` to the schema object and, in `superRefine`,

```ts
    if (info.operator) {
      if (v.operator.trim() === "") issue("operator", "Enter the address of the new operator key.");
      else if (supplierAddress(v.operator) === null) issue("operator", ADDRESS_ERROR);
    }
```

and in `orderInput` set `value: info.operator ? BigInt(supplierAddress(values.operator) ?? ZERO_ADDRESS) : info.value ? (amountUnits(values.value) ?? 0n) : 0n,`. (`supplierAddress` parses any 0x or qor1 address; its doc comment becomes "An address as 0x text, from a 0x or qor1 address; null when it is neither.")

In `apps/fe/src/modules/owner/api/owner.api.ts` extend `Rules` and `readRules`:

```ts
export type Rules = {
  state: VaultStateName;
  paused: boolean;
  repaid: bigint;
  totalOwed: bigint;
  dailyCap: bigint;
  spentToday: bigint;
  /** The owner share waiting in the vault. */
  ownerPending: bigint;
  /** The vault would pay the owner share now: Repaid, or Active and one installment ahead of schedule. */
  claimAhead: boolean;
  spender: Hex;
  operator: Hex;
};

export async function readRules(vault: Hex): Promise<Rules> {
  const [snapshot, dailyCap, spentToday, ownerPending, spender, operator, block] = await Promise.all([
    readVaultSnapshot(vault),
    readVault(vault, "dailyCap"),
    readVault(vault, "spentToday"),
    readVault(vault, "ownerPending"),
    readVault(vault, "spender"),
    readVault(vault, "operator"),
    publicClient.getBlock(),
  ]);
  // The vault's rule: repaid >= expectedRepaid(now + period), with now the block time it compares against.
  const ahead = await readVault(vault, "expectedRepaid", [block.timestamp + snapshot.period]);
  return {
    state: snapshot.state, paused: snapshot.paused, repaid: snapshot.repaid, totalOwed: snapshot.totalOwed, dailyCap, spentToday,
    ownerPending, spender, operator,
    claimAhead: snapshot.state === "Repaid" || (snapshot.state === "Active" && snapshot.repaid >= ahead),
  };
}

/** Sends the owner share to the payout address. Anyone may send it; the vault pays only `ownerPayout`. */
export const claimOwnerShare = (session: WalletSession, vault: Hex): Promise<Hex> =>
  act(session, [vault], (signer) => signer.send(vault, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "claimOwner" })));
```

In `apps/fe/src/modules/owner/api/useOwner.ts` add to `useOwnerActions`:

```ts
      claim: async (vault: Hex) => {
        const hash = await claimOwnerShare(session, vault);
        void client.invalidateQueries({ queryKey: ownerKeys.all });
        return hash;
      },
```

In `apps/fe/src/modules/owner/lib/precheck.ts`:

```ts
export const ENDED_SENTENCE = "The loan has ended, so the vault takes no more policy orders.";

export function precheck(kind: PolicyKind, value: bigint | null, rules: Rules): string | null {
  if (isEnded(rules.state)) return ENDED_SENTENCE;
  if (KIND_INFO[kind].widening && rules.state !== "Repaid") return LOCKED_SENTENCE;
  switch (kind) {
    case "Close":
      if (rules.state === "Repaid") return "A repaid loan cannot be closed.";
      return rules.state === "Active" || rules.state === "Trapped" ? null : "The loan can be closed only once it is funded and running.";
    // the existing cases stay unchanged below
```

In `apps/fe/src/modules/owner/lib/describe.ts` add to `orderSentence`

```ts
    case "Close":
      return "Close the loan and move the operating funds, the owner share and the bond to lenders";
    case "RotateAgent":
      return `Replace the agent keys with spending key ${supplier} and operator key ${shortAddress(`0x${order.value.toString(16).padStart(40, "0")}`)}`;
```

to `appliedTitle`

```ts
    case "Close":
      return "The loan is closed";
    case "RotateAgent":
      return "The agent keys are replaced";
```

and add:

```ts
/** What the Apply confirmation says. An irreversible order says so before anything is sent. */
export function applyBody(order: PolicyOrder): string {
  const base = "The vault checks your signature and then changes its rules. This sends one transaction from your test wallet, and the network fee is paid in QOR by that wallet.";
  return KIND_INFO[POLICY_KINDS[order.kind]]?.irreversible
    ? `${base} Closing ends the loan for good: the business stops selling and its operating funds, owner share and bond go to lenders. This cannot be undone.`
    : base;
}
```

In `apps/fe/src/modules/owner/components/OrderSignature.tsx` the Apply `ChainAction` takes `body={applyBody(built.order)}`. In `apps/fe/src/modules/owner/components/PolicyOrderForm.tsx`: `DEFAULTS` gains `operator: ""`; the target label is `{info.targetLabel ?? "Supplier address"}` and its help is `info.operator ? "The new spending key of the agent, starting with qor1 or 0x." : "The address the agent pays, starting with qor1 or 0x."`; after the target field add the operator field, built like the target field (same `Controller`, `Input`, error and help classes) with `name="operator"`, `id="owner-operator"`, label `New operator key` and help `The new operator key of the agent, starting with qor1 or 0x.`, rendered when `info.operator`.

Create `apps/fe/src/modules/owner/components/OwnerClaimCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChainAction } from "@/components/shared/ChainAction";
import { Button } from "@/components/ui/button";
import { formatFusd } from "@/lib/format";
import type { Business } from "@/lib/schemas";
import type { Rules } from "@/modules/owner/api/owner.api";
import { useOwnerActions } from "@/modules/owner/api/useOwner";

/** The owner share and the rule that releases it: one installment ahead of schedule, or once the loan is repaid. */
export function OwnerClaimCard({ business, rules, canSend }: { business: Business; rules: Rules; canSend: boolean }) {
  const [open, setOpen] = useState(false);
  const actions = useOwnerActions();
  const amount = formatFusd(rules.ownerPending);
  const rule = rules.claimAhead
    ? "The loan is one installment ahead of its schedule, so the share can be claimed now."
    : "The share can be claimed only while the loan is one installment ahead of its schedule, or once it is repaid. Until then it stays in the vault, and if the loan ends it goes to lenders.";
  return (
    <section aria-labelledby="owner-claim" className="flex flex-col gap-3 rounded-3xl bg-surface p-5 md:p-6">
      <h2 id="owner-claim" className="text-xl font-medium text-text-primary">
        Your share to claim
      </h2>
      <p className="text-[28px] font-medium tracking-[-0.8px] text-text-primary tabular-nums">{amount}</p>
      <p className="text-sm text-text-secondary">{rule}</p>
      {canSend && rules.claimAhead && rules.ownerPending > 0n && (
        <>
          <Button type="button" size="sm" className="w-fit" onClick={() => setOpen(true)}>
            Claim {amount}
          </Button>
          <ChainAction
            open={open}
            onOpenChange={setOpen}
            title={`Claim ${amount}`}
            body={`The owner share of ${business.name} will be paid to the payout address of the vault. Nothing else moves.`}
            confirmLabel={`Claim ${amount}`}
            pendingLabel={`Claiming ${amount}`}
            successTitle={`Claimed ${amount}`}
            successText="The owner share has been paid to the payout address."
            nextStep={{ text: "Check the owner console before claiming again.", label: "Open the owner console", href: "/owner" }}
            run={() => actions.claim(business.vault)}
          />
        </>
      )}
    </section>
  );
}
```

In `apps/fe/src/modules/owner/components/OwnerPage.tsx` render `<OwnerClaimCard business={business} rules={rules.data} canSend={testWalletOf(session) !== null} />` below `<RulesCard … />` in the right column (wrap both in `<div className="flex flex-col gap-6">`; read `session` with `useWallet((s) => s.session)`), and add to `RulesCard` rows `["Agent keys", \`${shortAddress(rules.spender)}, ${shortAddress(rules.operator)}\`]`.

- [ ] **Step 4: Run the tests and see them pass**

Run (in `apps/fe/`): `bun run test && bun run typecheck && bun run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/fe/src/modules/owner apps/fe/src/test/modules/owner
git commit -m "feat(fe): Close, RotateAgent and the owner claim rule in the console" -m "Spec sections 6, 7 and 11: the owner can sign a Close order (its confirmation says it cannot be undone) or replace both agent keys, every order of an ended vault is stopped before signing, and the console shows the owner share with the one-installment-ahead rule. Tests: vitest (all), typecheck and lint in apps/fe." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 18: Web app: Market and Business labels (bond, maturity, Unverified suppliers, unique buyers, rejection rate)

**Files:**
- Create: `apps/fe/src/lib/creationSuppliers.ts`, `apps/fe/src/lib/supplierCheck.ts`, `apps/fe/src/modules/market/lib/trackRecord.ts`, `apps/fe/src/components/shared/UnverifiedSuppliersBadge.tsx`
- Create tests: `apps/fe/src/test/lib/supplierCheck.test.ts`, `apps/fe/src/test/modules/market/lib/trackRecord.test.ts`, `apps/fe/src/test/modules/market/components/BusinessCard.test.tsx`, `apps/fe/src/test/modules/business/components/LoanTerms.test.tsx`
- Modify: `apps/fe/src/modules/business/api/business.api.ts`, `apps/fe/src/modules/business/api/useBusinessPage.ts`, `apps/fe/src/modules/market/api/market.api.ts`, `apps/fe/src/modules/market/components/BusinessCard.tsx`, `apps/fe/src/modules/business/components/{BusinessHeader,BusinessKpis,LoanTerms,VaultRules,BusinessPage}.tsx`
- Test: `apps/fe/src/test/modules/market/api/market.api.test.ts`, `apps/fe/src/test/modules/business/api/business.api.test.ts`

**Interfaces:**
- Consumes: Task 14 `VaultSnapshot` (`bondHeld`, `maturityAt`, `uniqueBuyers`, `version`), `Business.stats`, `isEnded`; `SUPPLIERS` from `@qredit/qore/suppliers`; Task 8 `VAULT_FACTORY_ABI` (v2 `create`).
- Produces:
  - `readCreationSuppliers(b: Pick<Business, "vault" | "startBlock">): Promise<Hex[]>` moved to `@/lib/creationSuppliers` (memoized per vault once read; business.api re-exports it)
  - `unknownSuppliers(addresses: readonly string[]): string[]`, `hasUnverifiedSuppliers(addresses: readonly string[]): boolean` (`@/lib/supplierCheck`)
  - `rejectionBps(stats: Business["stats"]): number | null`, `rejectionText(stats: Business["stats"]): string`, `buyersText(uniqueBuyers: number | null): string` (`@/modules/market/lib/trackRecord`)
  - `MarketEntry.unverified: boolean | null` (null when the creation call could not be read)
  - `useUnverifiedQuery(business: Business): boolean | undefined` (useBusinessPage.ts)
  - `<UnverifiedSuppliersBadge />`

- [ ] **Step 1: Write the failing tests**

Create `apps/fe/src/test/lib/supplierCheck.test.ts`:

```ts
import { expect, test } from "vitest";
import { SUPPLIERS } from "@qredit/qore/suppliers";
import { hasUnverifiedSuppliers, unknownSuppliers } from "@/lib/supplierCheck";

test("an address outside the Qredit supplier list is unverified, in any case", () => {
  const known = SUPPLIERS.dataIndexer.toUpperCase().replace("0X", "0x");
  const other = "0x00000000000000000000000000000000000000ee";
  expect(unknownSuppliers([known, other])).toEqual([other]);
  expect(hasUnverifiedSuppliers([known])).toBe(false);
  expect(hasUnverifiedSuppliers([known, other])).toBe(true);
});
```

Create `apps/fe/src/test/modules/market/lib/trackRecord.test.ts`:

```ts
import { expect, test } from "vitest";
import { buyersText, rejectionBps, rejectionText } from "@/modules/market/lib/trackRecord";

test("rejection rate is rejected over delivered reports", () => {
  expect(rejectionBps({ delivered: 8, rejected: 1, uniqueBuyers: 3 })).toBe(1250);
  expect(rejectionBps({ delivered: 0, rejected: 0, uniqueBuyers: 0 })).toBeNull();
  expect(rejectionBps(undefined)).toBeNull();
  expect(rejectionText({ delivered: 8, rejected: 1, uniqueBuyers: 3 })).toBe("12.5% of 8 delivered reports rejected");
  expect(rejectionText({ delivered: 0, rejected: 0, uniqueBuyers: 0 })).toBe("No reports delivered yet");
  expect(rejectionText(undefined)).toBe("Not known yet");
});

test("unique buyers read as a count, or say the vault does not count them", () => {
  expect(buyersText(1)).toBe("1 buyer");
  expect(buyersText(3)).toBe("3 buyers");
  expect(buyersText(null)).toBe("Not counted by this vault");
});
```

Create `apps/fe/src/test/modules/business/components/LoanTerms.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { LoanTerms } from "@/modules/business/components/LoanTerms";
import type { VaultSnapshot } from "@/modules/market";

const v2: VaultSnapshot = {
  state: "Active", raised: 50_000_000n, repaid: 1_000_000n, target: 50_000_000n, totalOwed: 55_000_000n, installment: 1_000_000n,
  period: 86_400n, raiseDeadline: new Date("2026-12-10T00:00:00Z"), lenderBps: 3000, paused: false,
  version: 2, bondHeld: 5_000_000n, swept: 0n, uniqueBuyers: 3, maturityAt: new Date("2027-01-20T12:00:00Z"),
};

test("a v2 loan shows the bond, the maturity date and what happens if it fails", () => {
  render(<LoanTerms vault={v2} />);
  expect(screen.getByText("5.00 fUSD, held in the vault")).toBeInTheDocument();
  expect(screen.getByText("20 Jan 2027, 12:00 UTC")).toBeInTheDocument();
  expect(screen.getByText(/anyone can end it/)).toBeInTheDocument();
});

test("an ended loan says the bond went to lenders", () => {
  render(<LoanTerms vault={{ ...v2, state: "Defaulted", bondHeld: 0n }} />);
  expect(screen.getByText("Moved to lenders when the loan ended")).toBeInTheDocument();
});

test("a v1 loan shows no bond row", () => {
  render(<LoanTerms vault={{ ...v2, version: 1, bondHeld: 0n, uniqueBuyers: null, maturityAt: null }} />);
  expect(screen.queryByText("Owner bond")).toBeNull();
});
```

Create `apps/fe/src/test/modules/market/components/BusinessCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { BusinessCard } from "@/modules/market/components/BusinessCard";

const entry = (unverified: boolean | null) =>
  ({
    business: {
      slug: "counterparty-check", vault: "0x1", name: "Counterparty Check", tagline: "t", services: [{ id: 0, name: "Grade", priceUnits: 250_000n }],
      operator: "0x2", spender: "0x3", startBlock: 1, version: 2, ended: null, stats: { delivered: 8, rejected: 1, uniqueBuyers: 3 },
    },
    vault: {
      state: "Active", raised: 50_000_000n, repaid: 0n, target: 50_000_000n, totalOwed: 55_000_000n, installment: 1_000_000n, period: 86_400n,
      raiseDeadline: new Date(0), lenderBps: 3000, paused: false, version: 2, bondHeld: 5_000_000n, swept: 0n, uniqueBuyers: 3, maturityAt: null,
    },
    orders: [], ordersDelivered: 8, deliveredCapped: false, unverified,
  }) as never;

test("the card shows the bond, the buyers and the rejection rate", () => {
  render(<BusinessCard entry={entry(false)} />);
  expect(screen.getByText("5.00 fUSD")).toBeInTheDocument();
  expect(screen.getByText("3 buyers")).toBeInTheDocument();
  expect(screen.getByText("12.5%")).toBeInTheDocument();
  expect(screen.queryByText("Unverified suppliers")).toBeNull();
});

test("a business paying a supplier outside the Qredit list is labelled", () => {
  render(<BusinessCard entry={entry(true)} />);
  expect(screen.getByText("Unverified suppliers")).toBeInTheDocument();
});
```

In `apps/fe/src/test/modules/market/api/market.api.test.ts` mock `@/lib/creationSuppliers` (`vi.mock("@/lib/creationSuppliers", () => ({ readCreationSuppliers: (...a: unknown[]) => creation(...a) }))` with `const creation = vi.fn();`), make the file's `beforeEach` give it a default answer (`beforeEach(() => { vi.resetAllMocks(); creation.mockResolvedValue([]); });`, so the earlier market tests keep a known supplier list) and append:

```ts
test("a market row says whether its suppliers are all in the Qredit list; a failed lookup says nothing", async () => {
  get.mockImplementation(async (path: string) => ({ data: path === "/v1/businesses" ? [wire("a", "0x1"), wire("b", "0x2")] : [] }));
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => VAULT_VALUES[functionName]);
  creation.mockImplementation(async (b: { vault: string }) => {
    if (b.vault === "0x2") throw new Error("log not found");
    return ["0x00000000000000000000000000000000000000ee"];
  });
  const rows = await getMarket();
  expect(rows.map((r) => ("unverified" in r ? r.unverified : "failed"))).toEqual([true, null]);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run (in `apps/fe/`): `bun run test -- src/test/lib/supplierCheck.test.ts src/test/modules/market src/test/modules/business`
Expected: failures: unresolved `@/lib/supplierCheck`, `@/modules/market/lib/trackRecord`, missing texts in `LoanTerms` and `BusinessCard`, and `unverified` missing on the market rows.

- [ ] **Step 3: Implement**

Create `apps/fe/src/lib/creationSuppliers.ts` (moved from `business.api.ts` so Market and Business share it; the body is the v1 one, plus the memo):

```ts
import { FACTORY_ADDRESS } from "@qredit/qore/abi";
import { VAULT_FACTORY_ABI } from "@qredit/qore/abis";
import { decodeFunctionData, getAbiItem } from "viem";
import { publicClient } from "@/lib/chain";
import type { Business } from "@/lib/schemas";

type Hex = `0x${string}`;
const VAULT_CREATED = getAbiItem({ abi: VAULT_FACTORY_ABI, name: "VaultCreated" });
// A creation never changes, so a read is kept for good (failures are not kept and are read again).
const known = new Map<string, Hex[]>();

/** The suppliers a v2 vault was created with, decoded from the factory's create call. */
export async function readCreationSuppliers(b: Pick<Business, "vault" | "startBlock">): Promise<Hex[]> {
  const hit = known.get(b.vault.toLowerCase());
  if (hit) return hit;
  const block = BigInt(b.startBlock);
  const logs = await publicClient.getLogs({ address: FACTORY_ADDRESS, event: VAULT_CREATED, args: { vault: b.vault }, fromBlock: block, toBlock: block });
  const log = logs[0];
  if (!log?.transactionHash) throw new Error("The vault creation could not be found on chain.");
  const tx = await publicClient.getTransaction({ hash: log.transactionHash });
  const call = decodeFunctionData({ abi: VAULT_FACTORY_ABI, data: tx.input });
  if (call.functionName !== "create") throw new Error("The vault was not created by a direct factory call.");
  const suppliers = call.args[0].suppliers.map((s) => s.toLowerCase() as Hex);
  known.set(b.vault.toLowerCase(), suppliers);
  return suppliers;
}
```

In `apps/fe/src/modules/business/api/business.api.ts` delete the moved function and its constants and add `export { readCreationSuppliers } from "@/lib/creationSuppliers";` (keep the import for `readVaultRules`). The existing `business.api.test.ts` tests of `readCreationSuppliers` keep importing it from `business.api`; give their factory calldata the v2 `Init` (no `token`, the three maturity terms), as `packages/qore/test/abi.test.ts` encodes it.

Create `apps/fe/src/lib/supplierCheck.ts`:

```ts
import { SUPPLIERS } from "@qredit/qore/suppliers";

const KNOWN = new Set(Object.values(SUPPLIERS).map((a) => a.toLowerCase()));

/** Suppliers that are not in Qredit's supplier list (`packages/qore/src/suppliers.json`). */
export const unknownSuppliers = (addresses: readonly string[]): string[] => addresses.filter((a) => !KNOWN.has(a.toLowerCase()));

/** The vault can pay an address Qredit does not know, which may be the owner's own (spec hole K1). */
export const hasUnverifiedSuppliers = (addresses: readonly string[]): boolean => unknownSuppliers(addresses).length > 0;
```

Create `apps/fe/src/modules/market/lib/trackRecord.ts`:

```ts
import { formatBps, formatCount } from "@/lib/format";
import type { Business } from "@/lib/schemas";

/** Rejected over delivered reports, in basis points; null before any delivery or when the stats are not known. */
export function rejectionBps(stats: Business["stats"]): number | null {
  if (!stats || stats.delivered === 0) return null;
  return Math.round((stats.rejected * 10_000) / stats.delivered);
}

export function rejectionText(stats: Business["stats"]): string {
  if (!stats) return "Not known yet";
  const bps = rejectionBps(stats);
  return bps === null ? "No reports delivered yet" : `${formatBps(bps)} of ${formatCount(stats.delivered)} delivered reports rejected`;
}

/** First-time buyers as the vault counts them; v1 vaults do not count them. */
export const buyersText = (uniqueBuyers: number | null): string =>
  uniqueBuyers === null ? "Not counted by this vault" : `${formatCount(uniqueBuyers)} ${uniqueBuyers === 1 ? "buyer" : "buyers"}`;
```

Create `apps/fe/src/components/shared/UnverifiedSuppliersBadge.tsx`:

```tsx
import { ShieldAlert } from "lucide-react";

/** Badge/Warning: a listed supplier is not in Qredit's supplier list, so it could be an address the owner controls. */
export function UnverifiedSuppliersBadge() {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1.5 text-[13px] leading-none font-medium text-warning">
      <ShieldAlert className="size-3.5" aria-hidden />
      Unverified suppliers
    </span>
  );
}
```

In `apps/fe/src/modules/market/api/market.api.ts`: add `unverified: boolean | null` to `MarketEntry`, give `toMarketEntry` a fourth parameter `unverified: boolean | null = null` stored on the entry, and in `getMarket` read the creation suppliers beside the vault and orders:

```ts
      const [vault, orders, created] = await Promise.allSettled([
        readVaultSnapshot(b.vault, b.version),
        getOrders(b.vault),
        readCreationSuppliers(b),
      ]);
      if (vault.status === "fulfilled" && orders.status === "fulfilled") {
        // A creation call that cannot be read gives no label, never a guess.
        const unverified = created.status === "fulfilled" ? hasUnverifiedSuppliers(created.value) : null;
        return toMarketEntry(b, vault.value, orders.value, unverified);
      }
```

In `apps/fe/src/modules/market/components/BusinessCard.tsx`: under the tagline add `{entry.unverified && <UnverifiedSuppliersBadge />}`; after the existing facts row add a second row with the same layout:

```tsx
      <div className="flex flex-col gap-2 md:flex-row md:gap-6">
        <Fact label="Bond" value={formatFusd(v.bondHeld)} />
        <Fact label="Buyers" value={buyersText(v.uniqueBuyers)} />
        <Fact label="Rejected" value={rejected === null ? "None yet" : formatBps(rejected)} />
      </div>
```

with `const rejected = rejectionBps(b.stats);` next to the existing `const { business: b, vault: v } = entry;`. Remove `mt-auto` from the first row's container and wrap both rows in `<div className="mt-auto flex flex-col gap-3">`, so cards keep one structure and height.

In `apps/fe/src/modules/business/components/LoanTerms.tsx` add after the Repayment term (import `isEnded`):

```tsx
        {vault.version === 2 && (
          <>
            <Term
              label="Owner bond"
              value={
                vault.bondHeld > 0n
                  ? `${formatFusd(vault.bondHeld)}, held in the vault`
                  : isEnded(vault.state)
                    ? "Moved to lenders when the loan ended"
                    : "Returned to the owner"
              }
            />
            <Term label="Maturity" value={vault.maturityAt ? formatDateTime(vault.maturityAt) : "Counted from the moment the raise completes"} />
            <Term
              label="If the loan fails"
              value="Once it falls far enough behind its schedule or passes maturity, anyone can end it, and the operating funds, the owner share and the bond go to lenders."
            />
          </>
        )}
```

In `apps/fe/src/modules/business/components/BusinessKpis.tsx` the Orders delivered tile takes `unit={ordersCapped ? \`in the latest ${ORDERS_LIMIT} orders\` : vault.uniqueBuyers !== null ? \`from ${buyersText(vault.uniqueBuyers)}\` : undefined}`.

In `apps/fe/src/modules/business/api/useBusinessPage.ts` export the creation query's verdict:

```ts
/** True when a supplier the vault was created with is not in Qredit's list; undefined while unknown. */
export function useUnverifiedQuery(business: Business): boolean | undefined {
  const suppliers = useCreationSuppliersQuery(business);
  return suppliers.data ? hasUnverifiedSuppliers(suppliers.data) : undefined;
}
```

In `apps/fe/src/modules/business/components/BusinessHeader.tsx` add the prop `unverified?: boolean` and render `{unverified && <UnverifiedSuppliersBadge />}` right after the state badge. In `BusinessPage.tsx` pass `unverified={useUnverifiedQuery(business)}` to the header, and give the Orders section `description={\`The newest orders placed with this business. ${rejectionText(business.stats)}.\`}`. In `VaultRules.tsx` add, under the supplier list, when one supplier is unknown (`unknownSuppliers(rules.suppliers.map((s) => s.address)).length > 0`): `<p className="text-sm text-text-secondary">One or more of these suppliers is not in the Qredit supplier list. The vault cannot tell a real supplier from an address the owner controls, so a payment to it is bounded only by the order price and the caps.</p>`.

- [ ] **Step 4: Run the tests and see them pass**

Run (in `apps/fe/`): `bun run test && bun run typecheck && bun run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/fe/src/lib apps/fe/src/components/shared/UnverifiedSuppliersBadge.tsx apps/fe/src/modules/market apps/fe/src/modules/business apps/fe/src/test
git commit -m "feat(fe): bond, maturity, buyers, rejection rate and unverified suppliers" -m "Spec sections 4, 8 and 11: lenders see the owner's bond and the maturity date, how many distinct buyers a business has (counted by the vault) and how often its reports are rejected (from the backend), and a business that can pay an address outside Qredit's supplier list is labelled Unverified suppliers. The creation-supplier read moves to src/lib so Market and Business share it. Tests: vitest (all), typecheck and lint in apps/fe." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 19: Web app: Default this loan (dry run first)

**Files:**
- Create: `apps/fe/src/modules/business/components/DefaultLoanCard.tsx`, `apps/fe/src/test/modules/business/components/DefaultLoanCard.test.tsx`
- Modify: `apps/fe/src/modules/business/api/business.api.ts`, `apps/fe/src/modules/business/api/business.keys.ts`, `apps/fe/src/modules/business/api/useBusinessPage.ts`, `apps/fe/src/modules/business/components/BusinessPage.tsx`
- Test: `apps/fe/src/test/modules/business/api/business.api.test.ts`

**Interfaces:**
- Consumes: Task 8 `LOAN_VAULT_ABI` (`triggerDefault`), `revertSentence`, `act`, `ChainAction`.
- Produces:
  - `simulateTriggerDefault(vault: Hex, from?: Hex): Promise<{ ok: true } | { ok: false; reason: string }>` (no transaction)
  - `triggerDefault(session: WalletSession, vault: Hex): Promise<Hex>`
  - `useDefaultDryRunQuery(vault: Hex, enabled: boolean)`, `useDefaultAction(vault: Hex): () => Promise<Hex>`
  - `<DefaultLoanCard business={Business} />`

- [ ] **Step 1: Write the failing tests**

Append to `apps/fe/src/test/modules/business/api/business.api.test.ts` (add `call: (...a: unknown[]) => call(...a)` to the mocked `publicClient`, with `const call = vi.fn();`; import `simulateTriggerDefault` and `encodeErrorResult` from `viem` and `LOAN_VAULT_ABI` from `@qredit/qore/abis`):

```ts
test("the default dry run sends nothing and says why the vault refuses", async () => {
  call.mockResolvedValueOnce({ data: "0x" });
  expect(await simulateTriggerDefault("0x1")).toEqual({ ok: true });
  const data = encodeErrorResult({ abi: LOAN_VAULT_ABI, errorName: "NotDefaultable" } as never);
  call.mockRejectedValueOnce(Object.assign(new Error("execution reverted"), { cause: { data } }));
  expect(await simulateTriggerDefault("0x1")).toEqual({ ok: false, reason: "The loan is not far enough behind its schedule or past its maturity to be defaulted." });
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ to: "0x1", data: expect.stringMatching(/^0x/) }));
});
```

Create `apps/fe/src/test/modules/business/components/DefaultLoanCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

const dryRun = vi.fn();
const send = vi.fn();
vi.mock("@/modules/business/api/useBusinessPage", () => ({
  useDefaultDryRunQuery: () => dryRun(),
  useDefaultAction: () => send,
}));
vi.mock("@/modules/wallet/WalletProvider", () => ({ useWallet: (pick: (s: unknown) => unknown) => pick({ session: { kind: "test" } }) }));
vi.mock("@/modules/wallet/signer", async (orig) => ({ ...(await orig<object>()), testWalletOf: () => ({ evm: "0x9" }) }));

import { DefaultLoanCard } from "@/modules/business/components/DefaultLoanCard";

beforeEach(() => vi.resetAllMocks());
const business = { vault: "0x1", name: "Due Diligence" } as never;

test("nothing shows while the vault would refuse the default", () => {
  dryRun.mockReturnValue({ data: { ok: false, reason: "x" } });
  const { container } = render(<DefaultLoanCard business={business} />);
  expect(container).toBeEmptyDOMElement();
});

test("when the dry run passes, the button asks first and says it cannot be undone", async () => {
  dryRun.mockReturnValue({ data: { ok: true } });
  render(<DefaultLoanCard business={business} />);
  await userEvent.click(screen.getByRole("button", { name: "Default this loan" }));
  expect(await screen.findByText(/This cannot be undone/)).toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run (in `apps/fe/`): `bun run test -- src/test/modules/business`
Expected: failures: `simulateTriggerDefault is not a function`, unresolved `DefaultLoanCard`.

- [ ] **Step 3: Implement**

In `apps/fe/src/modules/business/api/business.api.ts` add (imports: `encodeFunctionData` from `viem`, `LOAN_VAULT_ABI` from `@qredit/qore/abis`, `revertSentence` from `@/components/shared/vaultErrors`, `act` from `@/modules/wallet/act`, `type WalletSession` from `@/modules/wallet/session`):

```ts
const TRIGGER_DEFAULT = encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "triggerDefault" });

/** A dry run of `triggerDefault`: no transaction is sent. The vault decides, so the page never guesses from the schedule. */
export async function simulateTriggerDefault(vault: Hex, from?: Hex): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await publicClient.call({ account: from, to: vault, data: TRIGGER_DEFAULT });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: revertSentence(e) };
  }
}

/** Ends a loan that is far enough behind or past maturity. Anyone may send it; the test wallet pays the fee. */
export const triggerDefault = (session: WalletSession, vault: Hex): Promise<Hex> =>
  act(session, [vault], (signer) => signer.send(vault, TRIGGER_DEFAULT));
```

In `business.keys.ts` add `defaultable: (vault: string) => ["business", "defaultable", vault] as const,`. In `useBusinessPage.ts` add:

```ts
const DEFAULT_CHECK_MS = 30_000;

/** Whether the vault would accept a default now, checked by a dry run; only for a running loan. */
export const useDefaultDryRunQuery = (vault: `0x${string}`, enabled: boolean) =>
  useQuery({ queryKey: businessKeys.defaultable(vault), queryFn: () => simulateTriggerDefault(vault), enabled, refetchInterval: DEFAULT_CHECK_MS });

/** Sends the default from the test wallet, then reads the business, the market and lending again. */
export function useDefaultAction(vault: `0x${string}`) {
  const session = useWallet((s) => s.session);
  const client = useQueryClient();
  return useCallback(async () => {
    const hash = await triggerDefault(session, vault);
    void client.invalidateQueries({ queryKey: ["business"] });
    void client.invalidateQueries({ queryKey: marketKeys.all });
    void client.invalidateQueries({ queryKey: lendKeys.all });
    return hash;
  }, [session, client, vault]);
}
```

(imports: `useCallback`, `useQueryClient`, `useWallet`, `marketKeys` from `@/modules/market`, `lendKeys` from `@/modules/lend/api/lend.keys`; check that `lendKeys.all` exists in `lend.keys.ts`, otherwise use the key that `useLendActions` invalidates.)

Create `apps/fe/src/modules/business/components/DefaultLoanCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChainAction } from "@/components/shared/ChainAction";
import { Button } from "@/components/ui/button";
import type { Business } from "@/lib/schemas";
import { useDefaultAction, useDefaultDryRunQuery } from "@/modules/business/api/useBusinessPage";
import { ConnectPrompt } from "@/modules/wallet/components/ConnectPrompt";
import { testWalletOf } from "@/modules/wallet/signer";
import { useWallet } from "@/modules/wallet/WalletProvider";

/**
 * Shown only when a dry run says the vault would accept `triggerDefault` now (spec section 6). Anyone may send it;
 * it ends the loan for good, so it is confirmed first.
 */
export function DefaultLoanCard({ business, enabled = true }: { business: Business; enabled?: boolean }) {
  const dryRun = useDefaultDryRunQuery(business.vault, enabled);
  const run = useDefaultAction(business.vault);
  const wallet = useWallet((s) => testWalletOf(s.session));
  const [open, setOpen] = useState(false);
  if (!dryRun.data?.ok) return null;
  return (
    <section aria-labelledby="default-loan" className="flex flex-col gap-3 rounded-3xl bg-danger-soft p-5 md:flex-row md:items-center md:justify-between md:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="default-loan" className="text-lg font-medium text-text-primary">
          This loan can be defaulted
        </h2>
        <p className="text-sm text-text-secondary">
          The vault checked that the loan of {business.name} is far enough behind its schedule or past its maturity. Anyone may end it now.
        </p>
      </div>
      {wallet ? (
        <Button type="button" size="lg" variant="destructive" className="h-11" onClick={() => setOpen(true)}>
          Default this loan
        </Button>
      ) : (
        <ConnectPrompt size="lg" className="h-11" />
      )}
      <ChainAction
        open={open}
        onOpenChange={setOpen}
        title="Default this loan"
        body={`Defaulting ends the loan of ${business.name} for good: the business stops selling, and its operating funds, owner share and bond go to lenders, who claim them under My lending. This cannot be undone.`}
        confirmLabel="Default this loan"
        pendingLabel="Ending the loan"
        successTitle={`The loan of ${business.name} is defaulted`}
        successText="Lenders can now claim what the loan moved to them."
        nextStep={{ text: "Check the business page before trying again.", label: "Open the business", href: `/agents/${business.slug}` }}
        run={run}
      />
    </section>
  );
}
```

(If `components/ui/button.tsx` has no `destructive` variant, use the variant the design uses for danger actions in that file, and name it in the commit body.)

In `BusinessPage.tsx` render, right after the KPI block, `{snapshot && (snapshot.state === "Active" || snapshot.state === "Trapped") && <DefaultLoanCard business={business} />}`.

- [ ] **Step 4: Run the tests and see them pass**

Run (in `apps/fe/`): `bun run test && bun run typecheck && bun run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/fe/src/modules/business apps/fe/src/test/modules/business
git commit -m "feat(fe): Default this loan after a dry run" -m "Spec sections 6 and 11: when a dry run of triggerDefault passes, the business page offers Default this loan to anyone, confirmed first because it ends the loan for good; the page never guesses from the schedule. Tests: vitest (all), typecheck and lint in apps/fe." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 20: Proof page and attack list for v2

**Files:**
- Modify: `apps/fe/src/config/attacks.ts`, `apps/fe/src/modules/proof/checks.ts`
- Create: `apps/fe/src/test/config/attacks.test.ts`
- Test: `apps/fe/src/test/modules/proof/checks.test.ts`

**Interfaces:**
- Consumes: Task 9 smoke record (`engine/RESULTS.md`, dry-run refusals), Task 8 v2 `books()` (six values) and `FACTORY_RUNTIME_CODEHASH`.
- Produces: `ATTACKS` with 15 entries (the spec's eleven, `trapped-owner-claim` updated for `OwnerClaimNotAhead`, and `supplier-over-price`, `buy-from-owner`, `non-owner-close-rotate`, `settle-before-review`); `judgeBooks` text naming the bond.

- [ ] **Step 1: Write the failing tests**

Create `apps/fe/src/test/config/attacks.test.ts`:

```ts
import { expect, test } from "vitest";
import { ATTACKS } from "@/config/attacks";

test("the list holds the design's eleven attacks and the four of vault v2, once each", () => {
  const ids = ATTACKS.map((a) => a.id);
  expect(ids.length).toBe(15);
  expect(new Set(ids).size).toBe(15);
  expect(ids).toEqual(expect.arrayContaining(["supplier-over-price", "buy-from-owner", "non-owner-close-rotate", "settle-before-review", "trapped-owner-claim"]));
});

test("the owner-claim attack names the v2 refusal", () => {
  expect(ATTACKS.find((a) => a.id === "trapped-owner-claim")!.stoppedBy).toContain("OwnerClaimNotAhead");
});

test("every recorded hash has the right shape and nothing is guessed", () => {
  for (const a of ATTACKS) {
    if (a.txHash === null) continue;
    expect(a.txHash.kind === "evm" ? /^0x[0-9a-f]{64}$/.test(a.txHash.hash) : /^0x[0-9A-F]{64}$/.test(a.txHash.hash)).toBe(true);
  }
  for (const id of ["supplier-over-price", "buy-from-owner", "non-owner-close-rotate", "settle-before-review"]) {
    expect(ATTACKS.find((a) => a.id === id)!.txHash).toBeNull();
  }
});
```

In `apps/fe/src/test/modules/proof/checks.test.ts` the proven `judgeBooks` case passes six values (add a bond, for example `[1n, 2n, 3n, 4n, 0n, 5n]` against a balance of `15n`) and expects the detail `"Escrow, lender pool, owner share, operating funds, held funds and the owner's bond add up to the balance."`.

- [ ] **Step 2: Run the tests and see them fail**

Run (in `apps/fe/`): `bun run test -- src/test/config/attacks.test.ts src/test/modules/proof/checks.test.ts`
Expected: `expected 11 to be 15`, the `OwnerClaimNotAhead` assertion, and the `judgeBooks` text.

- [ ] **Step 3: Implement**

In `apps/fe/src/config/attacks.ts` change the list comment to "The eleven attacks of section 9 of the design spec, then the four that vault v2 adds (vault v2 spec, section 11). A hash is set only where engine/RESULTS.md or engine/spikes/RESULTS.md records a transaction that shows that attack stopped; a refusal recorded as a dry run (eth_call) has no transaction, so it stays null.", replace the `stoppedBy` of `trapped-owner-claim` with `"The vault pays the owner only while the loan is one installment ahead of its schedule, and refuses the claim with OwnerClaimNotAhead."`, and append:

```ts
  {
    id: "supplier-over-price",
    icon: Gauge,
    title: "A supplier payment above the order price",
    tried: "The spender tried to pay a listed supplier more for one order than the buyer paid for it.",
    stoppedBy:
      "The vault counts what each order has cost and refuses a payment that would pass the order's price with OverOrderPrice, so principal leaves only against real sales.",
    // engine/RESULTS.md, "Vault v2 smoke run": unit-tested refusal; no testnet transaction is recorded.
    txHash: null,
  },
  {
    id: "buy-from-owner",
    icon: UserX,
    title: "The owner buys from its own business",
    tried: "The owner's address placed an order to inflate the order count.",
    stoppedBy:
      "The vault refuses orders from the owner, payout, agent and supplier addresses with BuyerNotAllowed. An owner with other addresses can still buy from itself, which the threat model states.",
    // engine/RESULTS.md, "Vault v2 smoke run": refused in a dry run (eth_call), so there is no transaction.
    txHash: null,
  },
  {
    id: "non-owner-close-rotate",
    icon: PenLine,
    title: "A Close or key rotation without the owner's key",
    tried: "Someone without the owner's post-quantum key submitted a Close order and a RotateAgent order.",
    stoppedBy: "The vault checks the owner's ML-DSA-87 signature with the pqcVerify precompile and refuses with BadPqcSignature.",
    // engine/RESULTS.md, "Vault v2 smoke run": refused in a dry run (eth_call), so there is no transaction.
    txHash: null,
  },
  {
    id: "settle-before-review",
    icon: Hourglass,
    title: "Settling before the buyer's review ends",
    tried: "A sale was settled while the buyer could still reject the report.",
    stoppedBy: "The vault refuses a settlement until the review window has passed, with ReviewOpen.",
    // engine/RESULTS.md, "Vault v2 smoke run": refused in a dry run (eth_call), so there is no transaction.
    txHash: null,
  },
```

In `apps/fe/src/modules/proof/checks.ts` the proven `judgeBooks` detail becomes `"Escrow, lender pool, owner share, operating funds, held funds and the owner's bond add up to the balance."` (the sum already covers every value `books()` returns).

- [ ] **Step 4: Run the tests and see them pass**

Run (in `apps/fe/`): `bun run test && bun run typecheck && bun run lint`
Expected: all pass.

- [ ] **Step 5: Check the Proof page against the chain (read-only)**

Run (in `apps/fe/`): `bun run dev` (port 3000), open `http://localhost:3000/proof` for a v2 business.
Expected: the factory check is proven (the code hash matches, Task 8 Step 6), the books check is proven with the bond, and the four new attack cards say "Not recorded yet". Report any check that does not pass as it is.

- [ ] **Step 6: Commit**

```bash
git add apps/fe/src/config/attacks.ts apps/fe/src/modules/proof/checks.ts apps/fe/src/test/config/attacks.test.ts apps/fe/src/test/modules/proof/checks.test.ts
git commit -m "feat(fe): v2 attacks on the Proof page" -m "Spec section 11: the attack list adds the supplier payment above the order price, the owner buying from itself, Close or rotation without the owner's key and settling before the review ends, and the owner-claim refusal is now OwnerClaimNotAhead; the dry-run refusals have no transaction, so no hash is shown. The books check names the bond. Tests: vitest (all), typecheck and lint in apps/fe; Proof page checked against the testnet." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 21: Docs: READMEs, folder CLAUDE.md files, threat model, pointer from the main spec

**Files:**
- Modify: `README.md`, `sc/README.md`, `apps/be/CLAUDE.md`, `apps/fe/CLAUDE.md`, `engine/CLAUDE.md`, `docs/superpowers/specs/2026-11-24-qredit-design.md`
- Create: `docs/threat-model.md`

**Interfaces:**
- Consumes: everything above (the docs describe what was built and proven).
- Produces: docs only.

- [ ] **Step 1: Pointer from the main spec**

In `docs/superpowers/specs/2026-11-24-qredit-design.md`, directly under `## 6. \`LoanVault\` contract`, insert:

```markdown
> **Vault v2** ([2026-11-26-qredit-vault-v2-design.md](2026-11-26-qredit-vault-v2-design.md)) changes this section: the owner's bond, supplier spend bounded by each order's price, a buyer review before a sale is split, the owner claim only one installment ahead, default and Close, agent key rotation, a fixed token and buyer restrictions. v1 vaults stay on chain as described here.
```

- [ ] **Step 2: Threat model**

Create `docs/threat-model.md`:

```markdown
# Qredit threat model

What Qredit trusts, what the contracts enforce, and what they only bound. The contracts are `sc/src/LoanVault.sol` and `sc/src/VaultFactory.sol` (vault v2); the design is `docs/superpowers/specs/2026-11-24-qredit-design.md` with `docs/superpowers/specs/2026-11-26-qredit-vault-v2-design.md`.

## Trusted components

- `apps/be` holds the relayer, treasury and operator keys. It relays the agents' supplier payments and renews the operators' EVM windows; it runs no AI.
- The engine holds the agent keys. A leaked agent key can pay only listed suppliers within the caps and each order's price; the agent can pause the vault itself, and the owner can replace both agent keys with a signed RotateAgent order.
- The owner's ML-DSA-87 key signs every policy order.

## Enforced by the vault

- Lender principal moves only to listed suppliers, under the per-payment cap, the daily cap and the price of an open order.
- A sale is split only after the buyer's review (accept, or no rejection within 24 hours); a rejection returns the price less the supplier cost.
- The owner's share is paid only one installment ahead of schedule or after repayment.
- A loan three installments behind or past maturity plus grace can be ended by anyone; the operating funds, the owner share and the bond then go to lenders.
- While a loan runs, rules can only narrow; widening waits for repayment.

## Bounded, not closed

- **An owner-controlled supplier (K1).** The vault cannot tell a real supplier from an address the owner controls. Spend per order stops at its price, so moving principal to such an address needs real buyer money, of which lenders receive their share, and the bond (10 % of the target) is lost on a default. The Market labels a business whose suppliers are not all in Qredit's supplier list as Unverified suppliers.
- **Buying from oneself (K7).** The vault refuses orders from the owner's, the agent's and the suppliers' addresses, but an owner with other addresses can still buy from itself. The Market shows unique buyers and the rejection rate next to the order count.
- **Unfair rejections.** A buyer can reject a good report; there is no arbitration. The business keeps only what it already paid suppliers for that order.

## Out of scope

A curated on-chain supplier registry, third-party arbitration of rejections, owner stake slashing beyond the bond, and per-buyer rejection limits (see the roadmap in the README).
```

- [ ] **Step 3: READMEs**

In `README.md` replace the link list and add a roadmap:

```markdown
- Design: [docs/superpowers/specs/2026-11-24-qredit-design.md](docs/superpowers/specs/2026-11-24-qredit-design.md), with vault v2: [docs/superpowers/specs/2026-11-26-qredit-vault-v2-design.md](docs/superpowers/specs/2026-11-26-qredit-vault-v2-design.md)
- Threat model: [docs/threat-model.md](docs/threat-model.md)
- Contracts: [sc/](sc/)
- Spikes and their results: [engine/spikes/RESULTS.md](engine/spikes/RESULTS.md); the vault v2 smoke run: [engine/RESULTS.md](engine/RESULTS.md)

Vault v2 adds an owner's bond (10 % of the target), a buyer review before a sale is split, default and Close (the owner side goes to lenders), agent key rotation and buyer restrictions. v1 vaults stay on chain; the app lists only v2 for lending and buying, and still opens old orders and positions.

## Roadmap

- A curated on-chain supplier registry.
- Third-party arbitration of rejected reports.
- Owner stake slashing beyond the bond.
- Per-buyer rejection limits.
```

In `sc/README.md` add after the contract list:

```markdown
## Tests

    forge test

One file per area: `LoanVault.Raising`, `.Orders`, `.Review`, `.Suppliers`, `.Policy`, `.Claims`, `.Default`, `.Fuzz`, `.Invariant` and `VaultFactory`. The invariant handler buys, delivers, accepts, settles, rejects, declines, reclaims, pays suppliers, claims, defaults and closes; it checks that the books (with the bond) equal the balance, `repaid <= totalOwed`, lender claims stay within the pool, the owner never gets more than its share, supplier spend per order stays within the price, and an ended vault holds no owner money.
```

(keep the existing Test paragraph about `MockPqc.sol` under it).

- [ ] **Step 4: Folder CLAUDE.md files**

`apps/be/CLAUDE.md`, append to Layout:

```markdown
- Vault v2 (migration 003): businesses are keyed by vault and carry `version` (1 or 2) and `ended`; a slug has at most one vault per version, and `GET /v1/businesses/:slug` returns the newest. Orders add `in_review`, `settled` and `rejected` (`delivered` stays the final status of v1 orders), with `review_ends` and `refund`. The watcher decodes each vault with the events of its version (`VAULT_EVENTS_V1` or `VAULT_EVENTS`); `LoanEnded` sets `ended` once and `AgentRotated` moves the business's spender and operator, which the relayer and the window keeper read. `GET /v1/businesses` adds `stats` (delivered, rejected, unique buyers) per vault.
```

`engine/CLAUDE.md`, append to "Agent runner and demo buyer":

```markdown
- Vault v2: `deployments.json` holds the v2 vaults and `deployments.v1.json` the v1 ones (kept, not served). `business create` approves the factory for the bond and re-links the agent key to the v2 vault (revoking the v1 link in the same transaction) and registers the vault as version 2. The agent reads each claimed order from the vault before serving it and uses the vault's buyer, service, price, request and deadline (finding L3); `deliver` opens the buyer's review, and an idle tick (`settleDue`, at most once a minute) settles the agent's own orders whose review has ended. Ended vaults are still served so their open orders finish. `scripts/smoke-v2.ts a|b` is the recorded v2 smoke run (it spends testnet funds; ask first).
```

`apps/fe/CLAUDE.md`, update in place:
- in the Bundle rule, add `/abis-v1` to the light subpaths;
- in the Proof bullet, "lists the eleven attacks of the spec" becomes "lists the eleven attacks of the design spec and the four of vault v2";
- append:

```markdown
- Vault v2: `Business.version` decides which ABI reads a vault (`readVaultV1` in `lib/chain.ts` for v1 `loan()`; the Delivered event of each version in the inbox). The Market, lending and buying list only v2 (`getMarket` filters); the Inbox and My lending use `useBusinessesQuery` so v1 orders and positions still open. `lib/orderStatus.ts` holds `hasReport` and `isSettledSale`. The Report page offers Accept and Reject during the review (`ReviewActions`; Reject shows the refund, price less `supplierCost`, read when the dialog opens); the inbox list shows In review with the time left. A Defaulted or Closed position shows what the sweep added to Claim. The owner console adds Close (its confirmation says it cannot be undone), RotateAgent and the owner share with the one-installment-ahead rule. The business page shows the bond, the maturity date, unique buyers (from the vault), the rejection rate (from the backend), the Unverified suppliers label (creation suppliers not in `SUPPLIERS`), and Default this loan only after a dry run of `triggerDefault` passes.
```

- [ ] **Step 5: Check the docs**

Run: `git grep -n "TrappedNoOwnerClaim" -- ':!docs/superpowers' ':!packages/qore/src/generated/abis-v1.ts'`
Expected: no line outside the frozen v1 ABI and the design history.
Read every changed file once more for the repo rules: English only, no mention of how long anything took or of a schedule, no secret.

- [ ] **Step 6: Commit**

```bash
git add README.md sc/README.md apps/be/CLAUDE.md apps/fe/CLAUDE.md engine/CLAUDE.md docs/threat-model.md docs/superpowers/specs/2026-11-24-qredit-design.md
git commit -m "docs: vault v2 in the READMEs, folder guides and threat model" -m "Spec sections 8, 10 and 13: the main spec points to vault v2 from its contract section, the threat model states what v2 enforces and what it only bounds (owner-controlled suppliers, buying from oneself), the README gains the roadmap, and each folder's CLAUDE.md describes how it now works. Checked: git grep for the removed error name." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Tasks |
|---|---|
| §1 Why (K1 to K7) | K1: 2, 18; K2: 1, 4; K3: 4, 17; K4: 3, 15; K5: 5, 17; K6: 1; K7: 2, 18 |
| §2 States | 1 (enum, `ended`, `state()`), 4 (setting them), 8, 14 |
| §3 Owner bond | 1, 8 (`bondFor`), 9 (approval), 13, 18 |
| §4 Suppliers | 2, 18 (Unverified suppliers) |
| §5 Buyer review | 3, 10, 11, 12, 15 |
| §6 Owner share, default and close | 4, 16, 17, 19 |
| §7 Agent keys | 5, 10 (AgentRotated), 17 |
| §8 Buyers | 2, 18, 21 (threat model) |
| §9 Errors and events | 1 to 5, 8, Global Constraints |
| §10 Migration | 7, 9, 10, 13, 14 |
| §11 App changes | 8 (qore), 12 (engine), 10 and 11 (backend), 14 to 19 (web app), 20 (Proof and attacks) |
| §12 Testing | 1 to 6 (Foundry), 6 (invariants, fuzz), 9 (smoke run), every app task |
| §13 Out of scope | 21 (README roadmap, threat model) |

## Decisions made while planning

1. **Event names.** Solidity refuses an event and an error with the same name in one contract, so the spec's `Ended(kind)` event is `LoanEnded(uint8 kind)` and `Paused(by)` is `AgentPaused(address indexed by)`; the errors `Ended` and `Paused` keep their names (the apps already map `Paused`).
2. **Policy kinds.** `Close` = 8 and `RotateAgent` = 9 are appended, so v1 kind numbers and the web app's index mapping stay; widening is the explicit set {5, 6, 7}; `POLICY_TAG` stays `qredit-policy-v1` (the vault address in the digest already separates v1 and v2).
3. **Close states.** "Any non-ended, non-Raising state except Repaid" would include Refunded, where the bond must go back to the owner; Close is allowed only when Active or Trapped (`WrongState` otherwise).
4. **Default states.** `triggerDefault` needs Active or Trapped: a Raising vault has `activatedAt == 0`, so the maturity test would pass at once. A public `defaultable()` view holds the rule; the web app still decides with a dry run, as the spec asks.
5. **Ended checks.** `Ended` is checked first in `deposit`, `buy`, `applyOrder`, `claimOwner` and `triggerDefault`, and right after `NotSpender` in `paySupplier`. `selfPause`, `withdrawRemainder` and `withdrawBond` keep their own state checks.
6. **Owner claim.** Every state other than Repaid or Active-and-ahead reverts `OwnerClaimNotAhead` (Trapped included); `TrappedNoOwnerClaim` is removed.
7. **Bond.** The vault computes `bondHeld = target * BOND_BPS / 10_000` (must be above zero) and the factory pulls exactly `v.bondHeld()` after deploying; `withdrawRemainder` emits `RemainderWithdrawn(opex)` and `BondReturned(bond)` separately.
8. **Supplier checks order.** `paySupplier` checks the order (open, within price) after the supplier checks, so existing refusals keep their errors; it does not check the order deadline (an open order only).
9. **Review details.** `accept` has no time limit while the order is InReview; `reviewEnds` is appended last in `Order`; `orders()` returns `(buyer, serviceId, deadline, status, price, requestRef, reviewEnds)`.
10. **Sweep visibility.** A `swept` total is added to the vault so lending positions can show what the sweep added to Claim (pro rata, rounded down).
11. **RotateAgent and selfPause.** RotateAgent is allowed in every non-ended state (it is neutral), refuses a `value` above 160 bits, and lets spender equal operator; `selfPause` on a paused vault reverts `Paused`.
12. **Factory code hash.** The v2 factory has an immutable token, so `export-abi` fills that slot with fUSD before hashing; Task 8 checks it against the deployed code.
13. **Backend keys.** Businesses are keyed by vault with one row per (slug, version); `getBusiness(slug)` returns the newest version; a v1 `Delivered` stays the final `delivered` status; `AgentRotated` updates the business so the relayer and window keeper follow it.
14. **Stats sources.** Unique buyers are shown from the vault's `uniqueBuyers()` (the chain is the source); the backend also counts distinct buyers in `stats` for API readers; the rejection rate is rejected over delivered reports (v1 delivered, in review, settled, rejected) from backend events.
15. **v2 decline refund.** The `Declined` event has no refund field, so the Inbox reads `supplierCost` for v2 declined orders to show the true refund.
16. **Demo terms.** v1 periods, installments and grace stay; maturity is the smallest number of periods whose installments reach the debt, maturity grace is one period, `defaultAfterMissed = 3`. The smoke vault uses 600-second periods with no grace so it can be defaulted within the run.
17. **Agent re-link.** The v1 authenticator is revoked and the v2 vault linked in one hybrid transaction (`revokeAuthenticatorMsg` plus `linkAuthenticatorMsgs`); this is not proven before Task 13, which stops if the chain refuses it.
18. **Deployments files.** `engine/deployments.json` becomes the v2 file; the v1 file is kept as `engine/deployments.v1.json`.
19. **Smoke run.** It uses its own small vault, a new `smoke-operator` account, the treasury as owner and lender, and the demo buyer; refused attacks are recorded as dry runs (no transaction), so their attack cards keep "Not recorded yet".
20. **Engine.** The order is read from the vault at the start of `handleOrder` (before the request is opened and before sealing); a not-open order is "already-closed"; differences are logged and the vault's values used. Ended vaults are still served (open orders finish, reviews settle); the settle tick runs on idle at most once a minute.
21. **Review UI placement.** Accept and Reject sit on the Report page (the buyer reads before judging); the Inbox list shows the In review badge with the time left.
22. **Market.** Defaulted and Closed businesses show under All only; "Total lent" keeps counting Active, Trapped and Repaid; the Unverified label uses the creation supplier list (memoized), as the business page already does; the owner console lists only v2 vaults and gains an owner-share card.
23. **Threat model.** No threat model file existed although `CLAUDE.md` names one, so `docs/threat-model.md` is created.
24. **Bond and remainder in the apps.** The spec's app list names no button for `withdrawBond` or `withdrawRemainder`, so none is planned; both stay owner calls (`ownerPq`) outside the web app.
