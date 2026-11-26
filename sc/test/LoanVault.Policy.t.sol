// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {console} from "forge-std/console.sol";

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

    function test_addSupplierRefusesRolesAfterRepaid() public {
        _sell(2, 4);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        address[5] memory roles = [ownerPayout, ownerPq, spender, operator, address(vault)];
        for (uint256 k; k < roles.length; k++) {
            LoanVault.PolicyOrder memory o = _order(ADD_SUPPLIER, roles[k], 1e18);
            bytes memory sig = _sign(o);
            vm.expectRevert(LoanVault.BadOrder.selector);
            vault.applyOrder(o, sig);
        }
    }

    function test_unpauseWhenNotPausedReverts() public {
        LoanVault.PolicyOrder memory o = _order(UNPAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.BadOrder.selector);
        vault.applyOrder(o, sig);
        assertEq(vault.policyNonce(), 0);
    }

    function test_pauseWhenAlreadyPausedReverts() public {
        _apply(_order(PAUSE, address(0), 0));
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.BadOrder.selector);
        vault.applyOrder(o, sig);
        assertEq(vault.policyNonce(), 1);
    }

    /// Independent lowercase hex encoder (deliberately not the contract's _hex).
    function _toHex(bytes32 d) internal pure returns (string memory) {
        bytes memory out = new bytes(64);
        for (uint256 i; i < 32; i++) {
            uint8 hi = uint8(d[i]) / 16;
            uint8 lo = uint8(d[i]) % 16;
            out[2 * i] = bytes1(hi < 10 ? 48 + hi : 87 + hi);
            out[2 * i + 1] = bytes1(lo < 10 ? 48 + lo : 87 + lo);
        }
        return string(out);
    }

    function test_fixedSigningVector() public {
        address at = address(0x000000000000000000000000000000000000cA11);
        deployCodeTo("LoanVault.sol:LoanVault", abi.encode(IERC20(address(fusd)), _init()), at);
        LoanVault v = LoanVault(at);
        LoanVault.PolicyOrder memory o = LoanVault.PolicyOrder({
            kind: LOWER_DAILY_CAP,
            target: address(0),
            value: 5e18,
            nonce: 0,
            expiry: 1_900_000_000
        });
        bytes32 digest = keccak256(
            abi.encode(keccak256("qredit-policy-v1"), block.chainid, at, o.kind, o.target, o.value, o.nonce, o.expiry)
        );
        string memory text = string.concat("qredit-order-v1:0x", _toHex(digest));
        string memory full = string.concat("qorechain-msg-v1|qorechain-diana|", text);
        assertEq(v.orderDigest(o), digest);
        assertEq(keccak256(v.orderText(o)), keccak256(bytes(text)));
        assertEq(keccak256(v.signedBytes(o)), keccak256(bytes(full)));
        assertEq(v.orderText(o).length, 82);
        // pinned literal for chainid 31337, vault 0x...Ca11
        assertEq(digest, PINNED_DIGEST);
        console.log("vector chainId:", block.chainid);
        console.log("vector vault:", at);
        console.log("vector kind/target/value:", o.kind, o.target, o.value);
        console.log("vector nonce/expiry:", o.nonce, o.expiry);
        console.log("vector digest:", _toHex(digest));
        console.log("vector orderText:", text);
        console.log("vector signedBytes:", full);
    }

    bytes32 internal constant PINNED_DIGEST = 0x5d5bb129b0e312312ed45b5145b6b48adb811be00569221b533c0e70a064939f;

    function test_signatureForOtherVaultRefused() public {
        LoanVault other = _create(_init());
        assertTrue(address(other) != address(vault));
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o); // valid for `vault`
        vm.expectRevert(LoanVault.BadPqcSignature.selector);
        other.applyOrder(o, sig);
        vault.applyOrder(o, sig); // still valid for the vault it was made for
    }

    function test_signatureRefusedOnOtherChain() public {
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(LoanVault.BadPqcSignature.selector);
        vault.applyOrder(o, sig);
    }

    function test_signatureForOtherCosmosChainRefused() public {
        LoanVault.Init memory i = _init();
        i.cosmosChainId = "qorechain-vladi";
        LoanVault vladi = _create(i);
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        // signed over the diana prefix, but with this vault's own digest
        bytes memory dianaBytes = abi.encodePacked("qorechain-msg-v1|qorechain-diana|", vladi.orderText(o));
        bytes memory sig = abi.encodePacked(keccak256(abi.encodePacked("ok", hex"c0ffee", dianaBytes)));
        vm.expectRevert(LoanVault.BadPqcSignature.selector);
        vladi.applyOrder(o, sig);
        // sanity: the vault's own prefix is accepted
        bytes memory own = abi.encodePacked("qorechain-msg-v1|qorechain-vladi|", vladi.orderText(o));
        vladi.applyOrder(o, abi.encodePacked(keccak256(abi.encodePacked("ok", hex"c0ffee", own))));
        assertTrue(vladi.paused());
    }
}
