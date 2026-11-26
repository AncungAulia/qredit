// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultFuzzTest is Base {
    function testFuzz_splitConservesPrice(uint256 price, bool trapped) public {
        price = bound(price, 1, 1000e18);
        uint256[] memory prices = new uint256[](1);
        prices[0] = price;
        _fresh(prices, 60e18, 40e18);
        if (trapped) {
            uint256 t = block.timestamp + GRACE + PERIOD;
            vm.warp(t);
            assertEq(uint8(vault.state()), uint8(LoanVault.State.Trapped));
        }
        uint256 pool0 = vault.lenderPool();
        uint256 owner0 = vault.ownerPending();
        uint256 opex0 = vault.opexBalance();
        uint256 owed = OWED - vault.repaid();
        _settleNow(_buy(0));
        uint256 toLenders = vault.lenderPool() - pool0;
        uint256 toOwner = vault.ownerPending() - owner0;
        uint256 toOpex = vault.opexBalance() - opex0;
        assertEq(toLenders + toOwner + toOpex, price, "split must conserve the price");
        assertLe(toLenders, owed, "lender part above what is owed");
        if (trapped) assertEq(toOwner, 0);
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function testFuzz_lenderClaimsNeverExceedProRata(uint256 depositA, uint256 deliveries) public {
        depositA = bound(depositA, 1, TARGET - 1);
        deliveries = bound(deliveries, 1, 12);
        uint256[] memory prices = new uint256[](2);
        prices[0] = 3_333_333_333_333_333_333;
        prices[1] = 7e18 + 13;
        _fresh(prices, depositA, TARGET - depositA);
        for (uint256 k; k < deliveries; k++) {
            _settleNow(_buy(k % 2));
            uint256 repaid = vault.repaid();
            uint256 a = vault.lenderClaimable(lenderA);
            uint256 b = vault.lenderClaimable(lenderB);
            assertLe(a, repaid * depositA / TARGET, "lender A above pro-rata");
            assertLe(b, repaid * (TARGET - depositA) / TARGET, "lender B above pro-rata");
            assertLe(a + b, vault.lenderPool(), "claims above pool");
        }
    }

    function testFuzz_supplierSpendNeverExceedsOrderPrice(uint256[8] memory amounts, uint8[8] memory picks) public {
        _activate();
        uint256[3] memory ids = [_buy(0), _buy(1), _buy(2)];
        uint256 t = block.timestamp;
        for (uint256 k; k < 8; k++) {
            uint256 id = ids[picks[k] % 3];
            uint256 amount = bound(amounts[k], 1, CAP_A);
            t += 1 days; // a new day each time, so the daily cap never decides
            vm.warp(t);
            vm.prank(spender);
            try vault.paySupplier(supplierA, amount, id) {} catch {}
            for (uint256 j; j < 3; j++) {
                (,,,, uint256 price,,) = vault.orders(ids[j]);
                assertLe(vault.supplierCost(ids[j]), price, "spend on an order above its price");
            }
        }
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }

    function testFuzz_rejectReturnsPriceLessCost(uint256 spend) public {
        _activate();
        uint256 id = _buy(1); // 5 fUSD
        spend = bound(spend, 0, PRICE1);
        if (spend > 0) {
            vm.prank(spender);
            vault.paySupplier(supplierA, spend, id);
        }
        _deliver(id);
        uint256 before = fusd.balanceOf(buyer);
        uint256 opex = vault.opexBalance();
        vm.prank(buyer);
        vault.reject(id);
        assertEq(fusd.balanceOf(buyer) - before, PRICE1 - spend);
        assertEq(vault.opexBalance() - opex, spend);
        assertEq(_booksSum(), fusd.balanceOf(address(vault)));
    }
}
