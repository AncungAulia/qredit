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
