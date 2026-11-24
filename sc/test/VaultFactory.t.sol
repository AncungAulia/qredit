// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

contract VaultFactoryTest is Base {
    VaultFactory internal factory;

    function setUp() public override {
        super.setUp();
        factory = new VaultFactory();
    }

    function test_createsAndListsVaults() public {
        vm.recordLogs();
        LoanVault a = factory.create(_init());
        LoanVault b = factory.create(_init());
        assertEq(factory.count(), 2);
        assertEq(address(factory.vaultAt(0)), address(a));
        assertEq(address(factory.all()[1]), address(b));
        assertEq(a.operator(), operator);
        assertEq(a.ownerPq(), ownerPq);
        assertEq(uint8(a.state()), uint8(LoanVault.State.Raising));
        assertEq(vm.getRecordedLogs().length, 2);
    }

    function test_badConfigBubblesUp() public {
        LoanVault.Init memory i = _init();
        i.spender = address(0);
        vm.expectRevert(LoanVault.BadConfig.selector);
        factory.create(i);
    }
}
