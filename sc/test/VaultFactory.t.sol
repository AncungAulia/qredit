// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

contract VaultFactoryTest is Base {
    function test_createsAndListsVaults() public {
        uint256 before = factory.count(); // Base.setUp created one vault
        vm.recordLogs();
        LoanVault a = _create(_init());
        LoanVault b = _create(_init());
        assertEq(factory.count(), before + 2);
        assertEq(address(factory.vaultAt(before)), address(a));
        assertEq(address(factory.all()[before + 1]), address(b));
        assertEq(a.operator(), operator);
        assertEq(a.ownerPq(), ownerPq);
        assertEq(address(a.token()), address(fusd));
        assertEq(uint8(a.state()), uint8(LoanVault.State.Raising));
        // Each create logs the bond Transfer and VaultCreated.
        assertEq(vm.getRecordedLogs().length, 4);
    }

    function test_createPullsTheBondFromTheCaller() public {
        uint256 before = fusd.balanceOf(creator);
        LoanVault v = _create(_init());
        assertEq(fusd.balanceOf(creator), before - BOND);
        assertEq(fusd.balanceOf(address(v)), BOND);
        assertEq(v.bondHeld(), BOND);
    }

    function test_createWithoutAllowanceReverts() public {
        fusd.mint(stranger, BOND);
        vm.prank(stranger);
        vm.expectRevert(); // the token refuses: no allowance for the factory
        factory.create(_init());
    }

    function test_tokenIsFixedAtDeployment() public view {
        assertEq(address(factory.token()), address(fusd));
    }

    function test_zeroTokenRefused() public {
        vm.expectRevert(VaultFactory.BadToken.selector);
        new VaultFactory(IERC20(address(0)));
    }

    function test_badConfigBubblesUp() public {
        LoanVault.Init memory i = _init();
        i.spender = address(0);
        vm.prank(creator);
        vm.expectRevert(LoanVault.BadConfig.selector);
        factory.create(i);
    }
}
