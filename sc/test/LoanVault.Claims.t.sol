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
        vm.expectEmit(address(vault));
        emit LoanVault.Delivered(id, keccak256(abi.encode("envelope", id)), 2.5e18, 0, 2.5e18);
        _deliver(id);
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
        vm.expectEmit(address(vault));
        emit LoanVault.Delivered(id, keccak256(abi.encode("envelope", id)), 20e18, 20e18, 60e18);
        _deliver(id);
        assertEq(vault.repaid(), OWED);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        _sell(2, 1); // after repayment lenders get nothing more
        assertEq(vault.repaid(), OWED);
    }

    function test_businessKeepsSellingAfterRepaid() public {
        _sell(2, 4);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        _sell(0, 1);
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
        assertEq(fusd.balanceOf(ownerPayout), opex);
    }

    function test_sumOfLenderClaimsNeverExceedsPool() public {
        _sell(0, 7);
        vm.prank(lenderA);
        vault.claimLender();
        vm.prank(lenderB);
        vault.claimLender();
        assertGe(vault.lenderPool(), 0);
        (uint256 e, uint256 l, uint256 o, uint256 x, uint256 h) = vault.books();
        assertEq(e + l + o + x + h, fusd.balanceOf(address(vault)));
    }
}
