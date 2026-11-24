// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultRaisingTest is Base {
    function test_startsRaising() public view {
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Raising));
        assertEq(vault.activatedAt(), 0);
    }

    function test_depositsUntilTargetActivate() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Raising));
        assertEq(vault.raisedHeld(), 60e18);
        vm.prank(lenderB);
        vault.deposit(40e18);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Active));
        assertEq(vault.activatedAt(), block.timestamp);
        assertEq(vault.opexBalance(), TARGET);
        assertEq(vault.raisedHeld(), 0);
        assertEq(vault.deposits(lenderA), 60e18);
    }

    function test_depositOverTargetReverts() public {
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.OverTarget.selector);
        vault.deposit(TARGET + 1);
    }

    function test_zeroDepositReverts() public {
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_depositAfterActivationReverts() public {
        _activate();
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.deposit(1);
    }

    function test_refundedAfterDeadlineBelowTarget() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.warp(raiseDeadline + 1);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Refunded));
        uint256 before = fusd.balanceOf(lenderA);
        vm.prank(lenderA);
        vault.refund();
        assertEq(fusd.balanceOf(lenderA), before + 60e18);
        assertEq(vault.raisedHeld(), 0);
    }

    function test_refundWhileRaisingReverts() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.refund();
    }

    function test_refundTwiceReverts() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.warp(raiseDeadline + 1);
        vm.startPrank(lenderA);
        vault.refund();
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.refund();
        vm.stopPrank();
    }

    function test_constructorRejectsBadSplit() public {
        LoanVault.Init memory i = _init();
        i.lenderBps = 9000;
        i.ownerBps = 2000;
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(i);
    }

    function test_constructorRejectsMismatchedSuppliers() public {
        LoanVault.Init memory i = _init();
        i.supplierCaps = new uint256[](1);
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(i);
    }

    function test_booksMatchBalanceWhileRaising() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        (uint256 e, uint256 l, uint256 o, uint256 x, uint256 h) = vault.books();
        assertEq(e + l + o + x + h, fusd.balanceOf(address(vault)));
    }

    function _initWithSupplier(address who) internal view returns (LoanVault.Init memory i) {
        i = _init();
        i.suppliers[0] = who;
    }

    function test_constructorRejectsSelfDealingSuppliers() public {
        address[4] memory roles = [spender, operator, ownerPq, ownerPayout];
        for (uint256 k; k < roles.length; k++) {
            LoanVault.Init memory i = _initWithSupplier(roles[k]);
            vm.expectRevert(LoanVault.BadConfig.selector);
            new LoanVault(i);
        }
    }

    function test_constructorRejectsVaultItselfAsSupplier() public {
        // the vault is created at the next CREATE address of this test contract
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        LoanVault.Init memory i = _initWithSupplier(predicted);
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(i);
    }
}
