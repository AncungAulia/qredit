// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {MockPqcKeys, MockPqcVerify} from "./mocks/MockPqc.sol";
import {MockToken} from "./mocks/MockToken.sol";

abstract contract Base is Test {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEYS = 0x0000000000000000000000000000000000000a02;

    uint256 internal constant TARGET = 100e18;
    uint256 internal constant OWED = 110e18;
    uint256 internal constant INSTALLMENT = 10e18;
    uint64 internal constant PERIOD = 1 days;
    uint64 internal constant GRACE = 1 days;
    uint64 internal constant TTL = 1 hours;
    uint256 internal constant DAILY = 20e18;
    uint256 internal constant CAP_A = 10e18;
    uint256 internal constant CAP_B = 2e18;
    uint16 internal constant LENDER_BPS = 3000;
    uint16 internal constant OWNER_BPS = 2000;
    // service 0: 1 fUSD, service 1: 5 fUSD, service 2: 100 fUSD
    uint256 internal constant PRICE0 = 1e18;
    uint256 internal constant PRICE1 = 5e18;
    uint256 internal constant PRICE2 = 100e18;

    MockToken internal fusd;
    LoanVault internal vault;
    uint64 internal raiseDeadline;

    address internal spender = makeAddr("spender");
    address internal operator = makeAddr("operator");
    address internal ownerPq = makeAddr("ownerPq");
    address internal ownerPayout = makeAddr("ownerPayout");
    address internal lenderA = makeAddr("lenderA");
    address internal lenderB = makeAddr("lenderB");
    address internal buyer = makeAddr("buyer");
    address internal supplierA = makeAddr("supplierA");
    address internal supplierB = makeAddr("supplierB");
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        vm.etch(PQC_VERIFY, address(new MockPqcVerify()).code);
        vm.etch(PQC_KEYS, address(new MockPqcKeys()).code);
        fusd = new MockToken();
        raiseDeadline = uint64(block.timestamp + 7 days);
        vault = new LoanVault(_init());
        address[3] memory funded = [lenderA, lenderB, buyer];
        for (uint256 i; i < funded.length; i++) {
            fusd.mint(funded[i], 10_000e18);
            vm.prank(funded[i]);
            fusd.approve(address(vault), type(uint256).max);
        }
    }

    function _init() internal view returns (LoanVault.Init memory i) {
        address[] memory sup = new address[](2);
        sup[0] = supplierA;
        sup[1] = supplierB;
        uint256[] memory caps = new uint256[](2);
        caps[0] = CAP_A;
        caps[1] = CAP_B;
        uint256[] memory prices = new uint256[](3);
        prices[0] = PRICE0;
        prices[1] = PRICE1;
        prices[2] = PRICE2;
        i = LoanVault.Init({
            token: IERC20(address(fusd)),
            spender: spender,
            operator: operator,
            ownerPq: ownerPq,
            ownerPayout: ownerPayout,
            cosmosChainId: "qorechain-diana",
            lenderBps: LENDER_BPS,
            ownerBps: OWNER_BPS,
            dailyCap: DAILY,
            orderTtl: TTL,
            loan: LoanVault.LoanTerms({
                target: TARGET,
                totalOwed: OWED,
                raiseDeadline: raiseDeadline,
                period: PERIOD,
                grace: GRACE,
                installment: INSTALLMENT
            }),
            suppliers: sup,
            supplierCaps: caps,
            servicePrices: prices
        });
    }

    function _activate() internal {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.prank(lenderB);
        vault.deposit(40e18);
    }

    function _buy(uint256 serviceId) internal returns (uint256 id) {
        vm.prank(buyer);
        id = vault.buy(serviceId, keccak256(abi.encode("request", serviceId, block.timestamp)));
    }

    function _deliver(uint256 id) internal {
        vm.prank(operator);
        vault.deliver(id, keccak256(abi.encode("envelope", id)));
    }

    function _sell(uint256 serviceId, uint256 n) internal {
        for (uint256 k; k < n; k++) {
            _deliver(_buy(serviceId));
        }
    }

    function _order(uint8 kind, address target, uint256 value) internal view returns (LoanVault.PolicyOrder memory) {
        return LoanVault.PolicyOrder({
            kind: kind,
            target: target,
            value: value,
            nonce: vault.policyNonce(),
            expiry: uint64(block.timestamp + 1 hours)
        });
    }

    function _sign(LoanVault.PolicyOrder memory o) internal view returns (bytes memory) {
        return abi.encodePacked(keccak256(abi.encodePacked("ok", hex"c0ffee", vault.signedBytes(o))));
    }

    /// Replaces `vault` with a fresh one using custom service prices and funds it with two lenders' deposits.
    function _fresh(uint256[] memory prices, uint256 amountA, uint256 amountB) internal {
        LoanVault.Init memory i = _init();
        i.servicePrices = prices;
        _freshWith(i, amountA, amountB);
    }

    function _freshWith(LoanVault.Init memory i, uint256 amountA, uint256 amountB) internal {
        vault = new LoanVault(i);
        address[3] memory funded = [lenderA, lenderB, buyer];
        for (uint256 k; k < funded.length; k++) {
            vm.prank(funded[k]);
            fusd.approve(address(vault), type(uint256).max);
        }
        vm.prank(lenderA);
        vault.deposit(amountA);
        vm.prank(lenderB);
        vault.deposit(amountB);
    }
}
