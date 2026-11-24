// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {MockToken} from "./mocks/MockToken.sol";

contract VaultHandler is Test {
    LoanVault internal vault;
    MockToken internal fusd;
    address internal spender;
    address internal operator;
    address internal buyer;
    address internal supplier;
    address[2] internal lenders;

    constructor(LoanVault v, MockToken t, address s, address o, address b, address sup, address la, address lb) {
        (vault, fusd, spender, operator, buyer, supplier) = (v, t, s, o, b, sup);
        lenders = [la, lb];
    }

    function buy(uint256 serviceId) external {
        serviceId = bound(serviceId, 0, 2);
        vm.prank(buyer);
        try vault.buy(serviceId, bytes32(serviceId)) {} catch {}
    }

    function deliver(uint256 id) external {
        if (vault.orderCount() == 0) return;
        id = bound(id, 1, vault.orderCount());
        vm.prank(operator);
        try vault.deliver(id, bytes32(id)) {} catch {}
    }

    function decline(uint256 id) external {
        if (vault.orderCount() == 0) return;
        id = bound(id, 1, vault.orderCount());
        vm.prank(operator);
        try vault.decline(id, 0) {} catch {}
    }

    function reclaim(uint256 id) external {
        if (vault.orderCount() == 0) return;
        id = bound(id, 1, vault.orderCount());
        vm.prank(buyer);
        try vault.reclaim(id) {} catch {}
    }

    function pay(uint256 amount) external {
        amount = bound(amount, 1, 10e18);
        vm.prank(spender);
        try vault.paySupplier(supplier, amount, 0) {} catch {}
    }

    function claimLender(uint256 who) external {
        vm.prank(lenders[who % 2]);
        try vault.claimLender() {} catch {}
    }

    function claimOwner() external {
        try vault.claimOwner() {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }
}

contract LoanVaultInvariantTest is Base {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        _activate();
        handler = new VaultHandler(vault, fusd, spender, operator, buyer, supplierA, lenderA, lenderB);
        targetContract(address(handler));
    }

    function invariant_booksEqualBalance() public view {
        (uint256 e, uint256 l, uint256 o, uint256 x, uint256 h) = vault.books();
        assertEq(e + l + o + x + h, fusd.balanceOf(address(vault)));
    }

    function invariant_repaidNeverExceedsOwed() public view {
        assertLe(vault.repaid(), OWED);
    }

    function invariant_lenderClaimsCovered() public view {
        assertGe(vault.lenderPool(), vault.lenderClaimable(lenderA) + vault.lenderClaimable(lenderB));
    }
}
