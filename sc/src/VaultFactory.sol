// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {LoanVault} from "./LoanVault.sol";

/// @title VaultFactory
/// @notice Deploys LoanVaults and lists them for the Qredit market. Anyone may create a vault.
contract VaultFactory {
    LoanVault[] internal vaults;

    event VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index);

    function create(LoanVault.Init calldata init) external returns (LoanVault v) {
        v = new LoanVault(init);
        vaults.push(v);
        emit VaultCreated(address(v), init.ownerPq, init.spender, init.operator, vaults.length - 1);
    }

    function count() external view returns (uint256) {
        return vaults.length;
    }

    function vaultAt(uint256 index) external view returns (LoanVault) {
        return vaults[index];
    }

    function all() external view returns (LoanVault[] memory) {
        return vaults;
    }
}
