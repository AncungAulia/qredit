// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Stand-in for pqcVerify on Foundry's local EVM. A signature is valid when it
/// equals keccak256(abi.encodePacked(keccak256(abi.encodePacked("ok", pubkey, message)))).
contract MockPqcVerify {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return keccak256(signature) == keccak256(abi.encodePacked(keccak256(abi.encodePacked("ok", pubkey, message))));
    }
}

/// Stand-in for pqcKeyStatus. Storage slot 0 selects the answer:
/// 0 = registered and proven (key hex"c0ffee"), 1 = not registered, 2 = registered, not proven.
contract MockPqcKeys {
    uint256 internal mode;

    function pqcKeyStatus(address) external view returns (bool, uint8, bytes memory, bool) {
        if (mode == 1) return (false, 0, "", false);
        return (true, 1, hex"c0ffee", mode != 2);
    }
}
