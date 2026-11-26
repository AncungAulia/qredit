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
