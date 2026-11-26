// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultSuppliersTest is Base {
    function setUp() public override {
        super.setUp();
        _activate();
    }

    function _pay(address supplier, uint256 amount) internal {
        vm.prank(spender);
        vault.paySupplier(supplier, amount, 1);
    }

    function test_spenderPaysListedSupplier() public {
        vm.expectEmit(address(vault));
        emit LoanVault.SupplierPaid(supplierA, 3e18, 1);
        _pay(supplierA, 3e18);
        assertEq(fusd.balanceOf(supplierA), 3e18);
        assertEq(vault.opexBalance(), TARGET - 3e18);
        assertEq(vault.spentToday(), 3e18);
    }

    function test_onlySpenderPays() public {
        vm.prank(operator);
        vm.expectRevert(LoanVault.NotSpender.selector);
        vault.paySupplier(supplierA, 1e18, 1);
        vm.prank(ownerPq);
        vm.expectRevert(LoanVault.NotSpender.selector);
        vault.paySupplier(supplierA, 1e18, 1);
    }

    function test_unlistedSupplierReverts() public {
        vm.prank(spender);
        vm.expectRevert(LoanVault.SupplierNotAllowed.selector);
        vault.paySupplier(stranger, 1e18, 1);
    }

    function test_overSupplierCapReverts() public {
        vm.prank(spender);
        vm.expectRevert(LoanVault.OverSupplierCap.selector);
        vault.paySupplier(supplierB, CAP_B + 1, 1);
    }

    function test_zeroPaymentReverts() public {
        vm.prank(spender);
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.paySupplier(supplierA, 0, 1);
    }

    function test_dailyCapAndReset() public {
        _pay(supplierA, 10e18);
        _pay(supplierA, 10e18);
        vm.prank(spender);
        vm.expectRevert(LoanVault.OverDailyCap.selector);
        vault.paySupplier(supplierB, 1, 1);
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
        vm.prank(spender);
        vm.expectRevert(LoanVault.InsufficientOpex.selector);
        vault.paySupplier(supplierA, 1, 1);
    }

    function test_noPaymentsBeforeActivation() public {
        LoanVault fresh = _create(_init());
        vm.prank(spender);
        vm.expectRevert(LoanVault.WrongState.selector);
        fresh.paySupplier(supplierA, 1, 1);
    }

    function testFuzz_paymentNeverExceedsCaps(uint256 amount) public {
        amount = bound(amount, 1, 50e18);
        vm.prank(spender);
        if (amount > CAP_A) {
            vm.expectRevert(LoanVault.OverSupplierCap.selector);
            vault.paySupplier(supplierA, amount, 1);
        } else {
            vault.paySupplier(supplierA, amount, 1);
            assertLe(vault.spentToday(), DAILY);
        }
    }
}
