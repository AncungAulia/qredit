// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
        new LoanVault(IERC20(address(fusd)), i);
    }

    function test_constructorRejectsMismatchedSuppliers() public {
        LoanVault.Init memory i = _init();
        i.supplierCaps = new uint256[](1);
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(IERC20(address(fusd)), i);
    }

    function test_booksMatchBalanceWhileRaising() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
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
            new LoanVault(IERC20(address(fusd)), i);
        }
    }

    function test_constructorRejectsVaultItselfAsSupplier() public {
        // the vault is created at the next CREATE address of this test contract
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        LoanVault.Init memory i = _initWithSupplier(predicted);
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(IERC20(address(fusd)), i);
    }

    function test_depositAtRaiseDeadlineWorksAndOneAfterReverts() public {
        uint256 t = raiseDeadline;
        vm.warp(t);
        vm.prank(lenderA);
        vault.deposit(10e18);
        t += 1;
        vm.warp(t);
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.deposit(10e18);
    }

    function test_refundTwoLendersAfterPartialRaise() public {
        vm.prank(lenderA);
        vault.deposit(30e18);
        vm.prank(lenderB);
        vault.deposit(25e18);
        uint256 a0 = fusd.balanceOf(lenderA);
        uint256 b0 = fusd.balanceOf(lenderB);
        vm.warp(raiseDeadline + 1);
        vm.prank(lenderA);
        vault.refund();
        vm.prank(lenderB);
        vault.refund();
        assertEq(fusd.balanceOf(lenderA) - a0, 30e18);
        assertEq(fusd.balanceOf(lenderB) - b0, 25e18);
        assertEq(fusd.balanceOf(address(vault)), BOND, "only the bond is left");
        assertEq(vault.raisedHeld(), 0);
    }

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
}
