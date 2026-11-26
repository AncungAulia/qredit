// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LoanVault} from "./LoanVault.sol";

/// @title VaultFactory (v2)
/// @notice Deploys LoanVaults in one fixed token and lists them for the Qredit market. Anyone may create a vault;
/// the creator pays the owner's bond (BOND_BPS of the target) into the new vault.
contract VaultFactory {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    LoanVault[] internal vaults;

    event VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index);

    error BadToken();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert BadToken();
        token = token_;
    }

    function create(LoanVault.Init calldata init) external returns (LoanVault v) {
        v = new LoanVault(token, init);
        token.safeTransferFrom(msg.sender, address(v), v.bondHeld());
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
