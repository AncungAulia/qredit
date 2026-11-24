// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

contract DeployFactory is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        VaultFactory f = new VaultFactory();
        vm.stopBroadcast();
        console.log("VaultFactory", address(f));
    }
}
