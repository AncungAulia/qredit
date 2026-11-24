// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// QoreChain post-quantum precompiles (active on the qorechain-diana testnet).
/// pqcVerify lives at 0x…0a01 and pqcKeyStatus at 0x…0a02.
interface IQorePQC {
    /// ML-DSA-87 (FIPS 204) verification: 2592-byte key, 4627-byte signature.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// The ML-DSA-87 key an account registered on chain.
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}
