// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {SenderProbe} from "../src/spike/SenderProbe.sol";

contract DeployProbe is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        SenderProbe p = new SenderProbe();
        vm.stopBroadcast();
        console.log("SenderProbe", address(p));
    }
}
