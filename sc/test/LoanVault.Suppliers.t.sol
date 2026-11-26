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
