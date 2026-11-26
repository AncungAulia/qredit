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
