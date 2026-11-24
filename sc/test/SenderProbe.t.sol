// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SenderProbe} from "../src/spike/SenderProbe.sol";

contract SenderProbeTest is Test {
    function test_recordsSenderAndValue() public {
        SenderProbe p = new SenderProbe();
        address caller = makeAddr("caller");
        vm.prank(caller);
        p.ping(42);
        assertEq(p.lastSender(), caller);
        assertEq(p.lastValue(), 42);
    }

    function test_otherMarksMaxValue() public {
        SenderProbe p = new SenderProbe();
        p.other();
        assertEq(p.lastValue(), type(uint256).max);
    }
}
