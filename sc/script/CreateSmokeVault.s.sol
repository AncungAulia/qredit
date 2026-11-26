// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// Creates a small vault on testnet to check applyOrder with real ML-DSA-87 signatures.
/// Env: PRIVATE_KEY, FACTORY, OWNER_PQ (the 0x address of the signing account), SPENDER, OPERATOR, SUPPLIER.
/// Amounts are scaled to fUSD's 6 decimals. The supplier may not be any role address.
contract CreateSmokeVault is Script {
    function run() external {
        address[] memory sup = new address[](1);
        sup[0] = vm.envAddress("SUPPLIER");
        uint256[] memory caps = new uint256[](1);
        caps[0] = 1e6;
        uint256[] memory prices = new uint256[](1);
        prices[0] = 1e5;
        LoanVault.Init memory init = LoanVault.Init({
            spender: vm.envAddress("SPENDER"),
            operator: vm.envAddress("OPERATOR"),
            ownerPq: vm.envAddress("OWNER_PQ"),
            ownerPayout: vm.envAddress("OWNER_PQ"),
            cosmosChainId: "qorechain-diana",
            lenderBps: 3000,
            ownerBps: 2000,
            dailyCap: 5e6,
            orderTtl: 1 hours,
            loan: LoanVault.LoanTerms({
                target: 1e6,
                totalOwed: 11e5,
                raiseDeadline: uint64(block.timestamp + 30 days),
                period: 1 days,
                grace: 1 days,
                installment: 1e5,
                maturity: 11 days,
                maturityGrace: 1 days,
                defaultAfterMissed: 3
            }),
            suppliers: sup,
            supplierCaps: caps,
            servicePrices: prices
        });
        address factory = vm.envAddress("FACTORY");
        uint256 bond = init.loan.target * 1000 / 10_000; // LoanVault.BOND_BPS
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        IERC20(0x97143B771D34ddb9130b807b135Ae675A5a963CA).approve(factory, bond);
        LoanVault v = VaultFactory(factory).create(init);
        vm.stopBroadcast();
        console.log("SmokeVault", address(v));
    }
}
