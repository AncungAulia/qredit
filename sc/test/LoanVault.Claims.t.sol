// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultClaimsTest is Base {
    function setUp() public override {
        super.setUp();
        _activate();
    }

    function test_lendersClaimProRata() public {
        _sell(1, 1); // 1.5 fUSD to lenders
        uint256 a0 = fusd.balanceOf(lenderA);
        uint256 b0 = fusd.balanceOf(lenderB);
        vm.prank(lenderA);
        vault.claimLender();
        vm.prank(lenderB);
        vault.claimLender();
        assertEq(fusd.balanceOf(lenderA) - a0, 0.9e18);
        assertEq(fusd.balanceOf(lenderB) - b0, 0.6e18);
        assertEq(vault.lenderPool(), 0);
    }

    function test_claimWithNothingDueReverts() public {
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.claimLender();
    }

    function test_ownerClaimGoesToPayout() public {
        _sell(1, 1);
        vault.claimOwner();
        assertEq(fusd.balanceOf(ownerPayout), 1e18);
        assertEq(vault.ownerPending(), 0);
    }

    function test_trappedAfterMissedInstallment() public {
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Active));
        vm.warp(block.timestamp + GRACE + PERIOD);
        assertEq(vault.expectedRepaid(block.timestamp), INSTALLMENT);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Trapped));
    }

    function test_trappedRedirectsOwnerShareToLenders() public {
        vm.warp(block.timestamp + GRACE + PERIOD);
        uint256 id = _buy(1);
        _deliver(id);
        vm.expectEmit(address(vault));
        emit LoanVault.Settled(id, 2.5e18, 0, 2.5e18);
        _accept(id);
        assertEq(vault.ownerPending(), 0);
    }

    function test_ownerCannotClaimWhileTrapped() public {
        _sell(1, 1); // owner earns 1 fUSD while Active
        vm.warp(block.timestamp + GRACE + PERIOD);
        vm.expectRevert(LoanVault.TrappedNoOwnerClaim.selector);
        vault.claimOwner();
    }

    function test_backToActiveWhenCaughtUp() public {
        vm.warp(block.timestamp + GRACE + PERIOD);
        _sell(1, 4); // 4 × 2.5 = 10 fUSD to lenders while trapped
        assertEq(vault.repaid(), 10e18);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Active));
    }

    function test_repaidCapsLenderShare() public {
        _sell(2, 3); // 3 × 30 = 90
        assertEq(vault.repaid(), 90e18);
        uint256 id = _buy(2);
        _deliver(id);
        vm.expectEmit(address(vault));
        emit LoanVault.Settled(id, 20e18, 20e18, 60e18);
        _accept(id);
        assertEq(vault.repaid(), OWED);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        _sell(2, 1); // after repayment lenders get nothing more
        assertEq(vault.repaid(), OWED);
    }

    function test_businessKeepsSellingAfterRepaid() public {
        _sell(2, 4);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        uint256 pool = vault.lenderPool();
        uint256 repaidBefore = vault.repaid();
        uint256 id = _buy(0);
        _settleNow(id);
        (,,, LoanVault.OrderStatus st,,,) = vault.orders(id);
        assertEq(uint8(st), uint8(LoanVault.OrderStatus.Settled));
        assertEq(vault.lenderPool(), pool, "lender part must be 0");
        assertEq(vault.repaid(), repaidBefore);
    }

    function test_withdrawRemainderOnlyByOwnerWhenRepaid() public {
        vm.prank(ownerPq);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.withdrawRemainder();
        _sell(2, 4);
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotOwner.selector);
        vault.withdrawRemainder();
        uint256 opex = vault.opexBalance();
        vm.prank(ownerPq);
        vault.withdrawRemainder();
        assertEq(fusd.balanceOf(ownerPayout), opex + BOND, "opex and bond go back");
        assertEq(vault.bondHeld(), 0);
    }

    function test_sumOfLenderClaimsNeverExceedsPool() public {
        _sell(0, 7);
        vm.prank(lenderA);
        vault.claimLender();
        vm.prank(lenderB);
        vault.claimLender();
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function test_oddDepositsAndPricesRoundDownSafely() public {
        uint256[] memory prices = new uint256[](3);
        prices[0] = 3_333_333_333_333_333_333;
        prices[1] = 7e18 + 13;
        prices[2] = 1_000_000_000_000_000_001;
        _fresh(prices, 33e18, 67e18);
        for (uint256 k; k < 9; k++) {
            _settleNow(_buy(k % 3));
        }
        uint256 delivered = vault.repaid();
        assertGt(delivered, 0);
        vm.prank(lenderA);
        vault.claimLender();
        vm.prank(lenderB);
        vault.claimLender();
        uint256 claimed = vault.lenderClaimed(lenderA) + vault.lenderClaimed(lenderB);
        assertLe(claimed, delivered, "claims exceed lender part");
        assertLe(delivered - claimed, 2, "dust must not exceed the number of lenders");
        assertEq(vault.lenderPool(), delivered - claimed);
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function test_oddDepositsAndPricesAtSixDecimalScale() public {
        LoanVault.Init memory i = _init();
        uint256[] memory prices = new uint256[](3);
        prices[0] = 3_333_333;
        prices[1] = 7e6 + 13;
        prices[2] = 1_000_001;
        i.servicePrices = prices;
        i.loan.target = 100e6;
        i.loan.totalOwed = 110e6;
        i.loan.installment = 10e6;
        i.dailyCap = 20e6;
        i.supplierCaps[0] = 10e6;
        i.supplierCaps[1] = 2e6;
        _freshWith(i, 33e6, 67e6);
        // buyer's 18-decimal balance is plenty for these small prices
        for (uint256 k; k < 30; k++) {
            _settleNow(_buy(k % 3));
        }
        uint256 delivered = vault.repaid();
        assertGt(delivered, 0);
        vm.prank(lenderA);
        vault.claimLender();
        vm.prank(lenderB);
        vault.claimLender();
        uint256 claimed = vault.lenderClaimed(lenderA) + vault.lenderClaimed(lenderB);
        assertLe(claimed, delivered, "claims exceed lender part");
        assertLe(delivered - claimed, 2, "dust must not exceed the number of lenders");
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function test_claimLenderAndOwnerWorkAfterRepaid() public {
        _sell(2, 4);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        uint256 owner = vault.ownerPending();
        assertGt(owner, 0);
        vm.prank(lenderA);
        vault.claimLender();
        vm.prank(lenderB);
        vault.claimLender();
        assertEq(fusd.balanceOf(lenderA) + fusd.balanceOf(lenderB), 20_000e18 - TARGET + OWED);
        vault.claimOwner();
        assertEq(fusd.balanceOf(ownerPayout), owner);
    }

    function test_claimOwnerWorksAgainAfterTrappedReturnsToActive() public {
        _sell(1, 1); // owner earns 1 fUSD while Active
        assertEq(vault.ownerPending(), 1e18);
        uint256 t = block.timestamp + GRACE + PERIOD;
        vm.warp(t);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Trapped));
        _sell(1, 4); // 4 x 2.5 to lenders in Trapped, 1.5 already repaid -> 11.5 >= 10
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Active));
        assertEq(vault.ownerPending(), 1e18, "pending kept");
        vault.claimOwner();
        assertEq(fusd.balanceOf(ownerPayout), 1e18);
    }

    function test_buyAndPaySupplierWorkWhileTrapped() public {
        uint256 t = block.timestamp + GRACE + PERIOD;
        vm.warp(t);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Trapped));
        uint256 id = _buy(0);
        assertGt(id, 0);
        vm.prank(spender);
        vault.paySupplier(supplierA, 1e18, id);
        assertEq(fusd.balanceOf(supplierA), 1e18);
    }

    function test_stateAtTrapBoundary() public {
        uint256 t = block.timestamp + GRACE + PERIOD - 1;
        vm.warp(t);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Active));
        t += 1;
        vm.warp(t);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Trapped));
    }
}
