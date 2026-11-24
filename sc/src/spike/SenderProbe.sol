// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Spike-only contract: records who called it, to check how QoreChain
/// relays MsgExecuteEVM and windowed transactions. Not part of Qredit.
contract SenderProbe {
    address public lastSender;
    uint256 public lastValue;

    event Pinged(address indexed sender, uint256 value);

    function ping(uint256 value) external {
        lastSender = msg.sender;
        lastValue = value;
        emit Pinged(msg.sender, value);
    }

    function other() external {
        lastSender = msg.sender;
        lastValue = type(uint256).max;
    }
}
