// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultPolicyTest is Base {
    uint8 internal constant REMOVE_SUPPLIER = 0;
    uint8 internal constant LOWER_SUPPLIER_CAP = 1;
    uint8 internal constant LOWER_DAILY_CAP = 2;
    uint8 internal constant PAUSE = 3;
    uint8 internal constant UNPAUSE = 4;
    uint8 internal constant ADD_SUPPLIER = 5;
    uint8 internal constant RAISE_SUPPLIER_CAP = 6;
    uint8 internal constant RAISE_DAILY_CAP = 7;

    function setUp() public override {
        super.setUp();
        _activate();
    }

    function _apply(LoanVault.PolicyOrder memory o) internal {
        bytes memory sig = _sign(o); // compute first: _sign makes an external call that would consume the prank
        vm.prank(stranger); // anyone may submit; the signature is what counts
        vault.applyOrder(o, sig);
    }

    function test_signedBytesFormat() public view {
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory text = vault.orderText(o);
        assertEq(text.length, 82);
        assertEq(keccak256(vault.signedBytes(o)), keccak256(abi.encodePacked("qorechain-msg-v1|qorechain-diana|", text)));
    }

    function test_removeSupplierWithOwnerSignature() public {
        _apply(_order(REMOVE_SUPPLIER, supplierA, 0));
        (bool allowed,) = vault.suppliers(supplierA);
        assertFalse(allowed);
        assertEq(vault.policyNonce(), 1);
        vm.prank(spender);
        vm.expectRevert(LoanVault.SupplierNotAllowed.selector);
        vault.paySupplier(supplierA, 1, 1);
    }

    function test_badSignatureReverts() public {
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        vm.expectRevert(LoanVault.BadPqcSignature.selector);
        vault.applyOrder(o, hex"deadbeef");
    }

    function test_signatureBoundToOrderFields() public {
        LoanVault.PolicyOrder memory o = _order(LOWER_DAILY_CAP, address(0), 5e18);
        bytes memory sig = _sign(o);
        o.value = 1e18;
        vm.expectRevert(LoanVault.BadPqcSignature.selector);
        vault.applyOrder(o, sig);
    }

    function test_replayReverts() public {
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vault.applyOrder(o, sig);
        vm.expectRevert(LoanVault.BadNonce.selector);
        vault.applyOrder(o, sig);
    }

    function test_expiredOrderReverts() public {
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.warp(o.expiry + 1);
        vm.expectRevert(LoanVault.OrderExpiredSig.selector);
        vault.applyOrder(o, sig);
    }

    function test_wideningLockedDuringLoan() public {
        LoanVault.PolicyOrder memory o = _order(ADD_SUPPLIER, stranger, 1e18);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.WideningLocked.selector);
        vault.applyOrder(o, sig);
        o = _order(RAISE_DAILY_CAP, address(0), DAILY * 2);
        sig = _sign(o);
        vm.expectRevert(LoanVault.WideningLocked.selector);
        vault.applyOrder(o, sig);
    }

    function test_wideningAllowedAfterRepaid() public {
        _sell(2, 4);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        _apply(_order(ADD_SUPPLIER, stranger, 1e18));
        (bool allowed, uint256 cap) = vault.suppliers(stranger);
        assertTrue(allowed);
        assertEq(cap, 1e18);
        _apply(_order(RAISE_SUPPLIER_CAP, stranger, 2e18));
        _apply(_order(RAISE_DAILY_CAP, address(0), DAILY * 2));
        assertEq(vault.dailyCap(), DAILY * 2);
    }

    function test_lowerMustNarrow() public {
        LoanVault.PolicyOrder memory o = _order(LOWER_SUPPLIER_CAP, supplierA, CAP_A);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.NotNarrowing.selector);
        vault.applyOrder(o, sig);
        o = _order(LOWER_DAILY_CAP, address(0), DAILY + 1);
        sig = _sign(o);
        vm.expectRevert(LoanVault.NotNarrowing.selector);
        vault.applyOrder(o, sig);
    }

    function test_lowerCapsApply() public {
        _apply(_order(LOWER_SUPPLIER_CAP, supplierA, 1e18));
        _apply(_order(LOWER_DAILY_CAP, address(0), 2e18));
        (, uint256 cap) = vault.suppliers(supplierA);
        assertEq(cap, 1e18);
        assertEq(vault.dailyCap(), 2e18);
    }

    function test_pauseStopsBuyingAndPaying() public {
        _apply(_order(PAUSE, address(0), 0));
        vm.prank(buyer);
        vm.expectRevert(LoanVault.Paused.selector);
        vault.buy(0, bytes32(0));
        vm.prank(spender);
        vm.expectRevert(LoanVault.Paused.selector);
        vault.paySupplier(supplierA, 1, 1);
        _apply(_order(UNPAUSE, address(0), 0));
        _buy(0);
    }

    function test_unregisteredOwnerKeyReverts() public {
        vm.store(PQC_KEYS, bytes32(uint256(0)), bytes32(uint256(1)));
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.OwnerKeyNotRegistered.selector);
        vault.applyOrder(o, sig);
    }

    function test_unprovenOwnerKeyReverts() public {
        vm.store(PQC_KEYS, bytes32(uint256(0)), bytes32(uint256(2)));
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.OwnerKeyNotProven.selector);
        vault.applyOrder(o, sig);
    }

    function test_unknownKindReverts() public {
        LoanVault.PolicyOrder memory o = _order(8, address(0), 0);
        vm.expectRevert(LoanVault.UnknownKind.selector);
        vault.applyOrder(o, hex"");
    }
}
