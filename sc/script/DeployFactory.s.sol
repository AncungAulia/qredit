// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// Deploys the v2 factory in fUSD. Env: PRIVATE_KEY (deployer; needs an unscoped EVM window).
contract DeployFactory is Script {
    address internal constant FUSD = 0x97143B771D34ddb9130b807b135Ae675A5a963CA;

    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        VaultFactory f = new VaultFactory(IERC20(FUSD));
        vm.stopBroadcast();
        console.log("VaultFactory", address(f));
    }
}
