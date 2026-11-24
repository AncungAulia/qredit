// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultOrdersTest is Base {
    function setUp() public override {
        super.setUp();
        _activate();
    }

    function test_buyEscrowsPayment() public {
        uint256 id = _buy(1);
        (address b, uint32 sid, uint64 deadline, LoanVault.OrderStatus st, uint256 price,) = vault.orders(id);
        assertEq(b, buyer);
        assertEq(sid, 1);
        assertEq(deadline, block.timestamp + TTL);
        assertEq(uint8(st), uint8(LoanVault.OrderStatus.Open));
        assertEq(price, PRICE1);
        assertEq(vault.escrowTotal(), PRICE1);
    }

    function test_buyBeforeActivationReverts() public {
        LoanVault fresh = new LoanVault(_init());
        vm.prank(buyer);
        vm.expectRevert(LoanVault.WrongState.selector);
        fresh.buy(0, bytes32(0));
    }

    function test_unknownServiceReverts() public {
        vm.prank(buyer);
        vm.expectRevert(LoanVault.UnknownService.selector);
        vault.buy(3, bytes32(0));
    }

    function test_deliverSplitsLendersFirst() public {
        uint256 id = _buy(1); // 5 fUSD
        vm.expectEmit(address(vault));
        emit LoanVault.Delivered(id, keccak256(abi.encode("envelope", id)), 1.5e18, 1e18, 2.5e18);
        _deliver(id);
        assertEq(vault.repaid(), 1.5e18);
        assertEq(vault.lenderPool(), 1.5e18);
        assertEq(vault.ownerPending(), 1e18);
        assertEq(vault.opexBalance(), TARGET + 2.5e18);
        assertEq(vault.escrowTotal(), 0);
    }

    function test_onlyOperatorDelivers() public {
        uint256 id = _buy(0);
        vm.prank(spender);
        vm.expectRevert(LoanVault.NotOperator.selector);
        vault.deliver(id, bytes32(0));
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotOperator.selector);
        vault.deliver(id, bytes32(0));
    }

    function test_deliverAfterDeadlineReverts() public {
        uint256 id = _buy(0);
        vm.warp(block.timestamp + TTL + 1);
        vm.prank(operator);
        vm.expectRevert(LoanVault.OrderExpired.selector);
        vault.deliver(id, bytes32(0));
    }

    function test_deliverTwiceReverts() public {
        uint256 id = _buy(0);
        _deliver(id);
        vm.prank(operator);
        vm.expectRevert(LoanVault.OrderNotOpen.selector);
        vault.deliver(id, bytes32(0));
    }

    function test_declineRefundsBuyerAtOnce() public {
        uint256 before = fusd.balanceOf(buyer);
        uint256 id = _buy(1);
        vm.prank(operator);
        vault.decline(id, 2);
        assertEq(fusd.balanceOf(buyer), before);
        assertEq(vault.escrowTotal(), 0);
        (,,, LoanVault.OrderStatus st,,) = vault.orders(id);
        assertEq(uint8(st), uint8(LoanVault.OrderStatus.Declined));
    }

    function test_onlyOperatorDeclines() public {
        uint256 id = _buy(0);
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotOperator.selector);
        vault.decline(id, 1);
    }

    function test_reclaimAfterDeadline() public {
        uint256 before = fusd.balanceOf(buyer);
        uint256 id = _buy(1);
        vm.warp(block.timestamp + TTL + 1);
        vm.prank(buyer);
        vault.reclaim(id);
        assertEq(fusd.balanceOf(buyer), before);
    }

    function test_reclaimBeforeDeadlineReverts() public {
        uint256 id = _buy(1);
        vm.prank(buyer);
        vm.expectRevert(LoanVault.OrderNotExpired.selector);
        vault.reclaim(id);
    }

    function test_reclaimByStrangerReverts() public {
        uint256 id = _buy(1);
        vm.warp(block.timestamp + TTL + 1);
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotBuyer.selector);
        vault.reclaim(id);
    }

    function test_booksMatchBalanceAfterOrders() public {
        _sell(1, 3);
        _buy(0);
        uint256 d = _buy(1);
        vm.prank(operator);
        vault.decline(d, 0);
        (uint256 e, uint256 l, uint256 o, uint256 x, uint256 h) = vault.books();
        assertEq(e + l + o + x + h, fusd.balanceOf(address(vault)));
    }
}
