// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IQorePQC} from "./interfaces/IQorePQC.sol";

/// @title LoanVault
/// @notice Working capital for one AI agent business. Lenders fund it in fUSD; the agent's
/// spender may pay only listed suppliers under caps; buyers' payments sit in escrow until the
/// agent's operator delivers a sealed report, then the contract splits them, lenders first.
/// Policy changes need the owner's ML-DSA-87 signature (checked by the pqcVerify precompile),
/// and while the loan runs only changes that narrow the rules are accepted.
contract LoanVault {
    using SafeERC20 for IERC20;

    IQorePQC internal constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC internal constant PQC_KEYS = IQorePQC(0x0000000000000000000000000000000000000a02);

    uint256 internal constant BPS = 10_000;
    uint256 internal constant ACC = 1e18;
    bytes32 internal constant POLICY_TAG = keccak256("qredit-policy-v1");

    enum State { Raising, Active, Trapped, Repaid, Refunded }
    enum OrderStatus { None, Open, Delivered, Declined, Reclaimed }
    enum Kind { RemoveSupplier, LowerSupplierCap, LowerDailyCap, Pause, Unpause, AddSupplier, RaiseSupplierCap, RaiseDailyCap }

    struct LoanTerms {
        uint256 target;
        uint256 totalOwed;
        uint64 raiseDeadline;
        uint64 period;
        uint64 grace;
        uint256 installment;
    }

    struct Init {
        IERC20 token;
        address spender;
        address operator;
        address ownerPq;
        address ownerPayout;
        string cosmosChainId;
        uint16 lenderBps;
        uint16 ownerBps;
        uint256 dailyCap;
        uint64 orderTtl;
        LoanTerms loan;
        address[] suppliers;
        uint256[] supplierCaps;
        uint256[] servicePrices;
    }

    struct Supplier {
        bool allowed;
        uint256 perTxCap;
    }

    struct Order {
        address buyer;
        uint32 serviceId;
        uint64 deadline;
        OrderStatus status;
        uint256 price;
        bytes32 requestRef;
    }

    struct PolicyOrder {
        uint8 kind;
        address target;
        uint256 value;
        uint64 nonce;
        uint64 expiry;
    }

    // Roles and fixed terms
    IERC20 public immutable token;
    address public immutable spender;
    address public immutable operator;
    address public immutable ownerPq;
    address public immutable ownerPayout;
    uint16 public immutable lenderBps;
    uint16 public immutable ownerBps;
    uint64 public immutable orderTtl;
    bytes public cosmosChainId;
    LoanTerms public loan;

    // Spending policy
    mapping(address => Supplier) public suppliers;
    uint256[] internal servicePrices;
    uint256 public dailyCap;
    uint256 public spentToday;
    uint64 public dayIndex;
    bool public paused;
    uint64 public policyNonce;

    // Loan accounting
    uint64 public activatedAt;
    uint256 public raised;
    uint256 public repaid;
    mapping(address => uint256) public deposits;
    uint256 public accPerShare;
    mapping(address => uint256) public lenderClaimed;

    // Books: balance == escrowTotal + lenderPool + ownerPending + opexBalance + raisedHeld
    uint256 public escrowTotal;
    uint256 public lenderPool;
    uint256 public ownerPending;
    uint256 public opexBalance;
    uint256 public raisedHeld;

    // Orders
    uint256 public orderCount;
    mapping(uint256 => Order) public orders;

    event Deposited(address indexed lender, uint256 amount);
    event Activated(uint256 at);
    event Refunded(address indexed lender, uint256 amount);
    event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline);
    event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 toLenders, uint256 toOwner, uint256 toOpex);
    event Declined(uint256 indexed orderId, uint8 reasonCode);
    event Reclaimed(uint256 indexed orderId);
    event SupplierPaid(address indexed supplier, uint256 amount, uint256 indexed orderId);
    event LenderClaimed(address indexed lender, uint256 amount);
    event OwnerClaimed(uint256 amount);
    event PolicyApplied(uint64 indexed nonce, uint8 kind, address target, uint256 value);
    event RemainderWithdrawn(uint256 amount);

    error BadConfig();
    error WrongState();
    error ZeroAmount();
    error OverTarget();
    error Paused();
    error UnknownService();
    error NotOperator();
    error NotSpender();
    error NotOwner();
    error NotBuyer();
    error OrderNotOpen();
    error OrderExpired();
    error OrderNotExpired();
    error SupplierNotAllowed();
    error OverSupplierCap();
    error OverDailyCap();
    error InsufficientOpex();
    error TrappedNoOwnerClaim();
    error OwnerKeyNotRegistered();
    error OwnerKeyNotProven();
    error BadNonce();
    error OrderExpiredSig();
    error BadPqcSignature();
    error UnknownKind();
    error WideningLocked();
    error NotNarrowing();
    error BadOrder();

    constructor(Init memory init) {
        if (
            address(init.token) == address(0) || init.spender == address(0) || init.operator == address(0)
                || init.ownerPq == address(0) || init.ownerPayout == address(0)
        ) revert BadConfig();
        if (uint256(init.lenderBps) + init.ownerBps > BPS) revert BadConfig();
        if (init.suppliers.length != init.supplierCaps.length || init.servicePrices.length == 0) revert BadConfig();
        LoanTerms memory l = init.loan;
        if (
            l.target == 0 || l.totalOwed < l.target || l.period == 0 || l.installment == 0
                || l.raiseDeadline <= block.timestamp || init.orderTtl == 0 || bytes(init.cosmosChainId).length == 0
        ) revert BadConfig();

        token = init.token;
        spender = init.spender;
        operator = init.operator;
        ownerPq = init.ownerPq;
        ownerPayout = init.ownerPayout;
        lenderBps = init.lenderBps;
        ownerBps = init.ownerBps;
        orderTtl = init.orderTtl;
        cosmosChainId = bytes(init.cosmosChainId);
        loan = l;
        dailyCap = init.dailyCap;
        for (uint256 i; i < init.suppliers.length; i++) {
            if (init.suppliers[i] == address(0) || init.supplierCaps[i] == 0) revert BadConfig();
            suppliers[init.suppliers[i]] = Supplier(true, init.supplierCaps[i]);
        }
        for (uint256 i; i < init.servicePrices.length; i++) {
            if (init.servicePrices[i] == 0) revert BadConfig();
            servicePrices.push(init.servicePrices[i]);
        }
    }

    // ---------------------------------------------------------------- views

    function state() public view returns (State) {
        if (activatedAt == 0) return block.timestamp > loan.raiseDeadline ? State.Refunded : State.Raising;
        if (repaid >= loan.totalOwed) return State.Repaid;
        return repaid < expectedRepaid(block.timestamp) ? State.Trapped : State.Active;
    }

    /// Minimum lender repayment due by time t: one installment per full period after the grace.
    function expectedRepaid(uint256 t) public view returns (uint256) {
        if (activatedAt == 0 || t <= uint256(activatedAt) + loan.grace) return 0;
        uint256 periods = (t - activatedAt - loan.grace) / loan.period;
        uint256 e = periods * loan.installment;
        return e > loan.totalOwed ? loan.totalOwed : e;
    }

    function serviceCount() external view returns (uint256) {
        return servicePrices.length;
    }

    function servicePrice(uint256 serviceId) external view returns (uint256) {
        return servicePrices[serviceId];
    }

    function lenderClaimable(address lender) public view returns (uint256) {
        return deposits[lender] * accPerShare / ACC - lenderClaimed[lender];
    }

    function books() external view returns (uint256 escrow, uint256 lenders, uint256 ownerOwed, uint256 opex, uint256 held) {
        return (escrowTotal, lenderPool, ownerPending, opexBalance, raisedHeld);
    }

    // -------------------------------------------------------------- lenders

    function deposit(uint256 amount) external {
        if (state() != State.Raising) revert WrongState();
        if (amount == 0) revert ZeroAmount();
        if (raised + amount > loan.target) revert OverTarget();
        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        raised += amount;
        raisedHeld += amount;
        emit Deposited(msg.sender, amount);
        if (raised == loan.target) {
            activatedAt = uint64(block.timestamp);
            opexBalance += raisedHeld;
            raisedHeld = 0;
            emit Activated(block.timestamp);
        }
    }

    function refund() external {
        if (state() != State.Refunded) revert WrongState();
        uint256 amount = deposits[msg.sender];
        if (amount == 0) revert ZeroAmount();
        deposits[msg.sender] = 0;
        raisedHeld -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }

    function claimLender() external {
        uint256 amount = lenderClaimable(msg.sender);
        if (amount == 0) revert ZeroAmount();
        lenderClaimed[msg.sender] += amount;
        lenderPool -= amount;
        token.safeTransfer(msg.sender, amount);
        emit LenderClaimed(msg.sender, amount);
    }

    // --------------------------------------------------------------- orders

    function buy(uint256 serviceId, bytes32 requestRef) external returns (uint256 id) {
        if (activatedAt == 0) revert WrongState();
        if (paused) revert Paused();
        if (serviceId >= servicePrices.length) revert UnknownService();
        uint256 price = servicePrices[serviceId];
        token.safeTransferFrom(msg.sender, address(this), price);
        id = ++orderCount;
        uint64 deadline = uint64(block.timestamp) + orderTtl;
        orders[id] = Order(msg.sender, uint32(serviceId), deadline, OrderStatus.Open, price, requestRef);
        escrowTotal += price;
        emit OrderPlaced(id, msg.sender, serviceId, price, requestRef, deadline);
    }

    function deliver(uint256 id, bytes32 envelopeHash) external {
        if (msg.sender != operator) revert NotOperator();
        Order storage o = orders[id];
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        if (block.timestamp > o.deadline) revert OrderExpired();
        o.status = OrderStatus.Delivered;
        escrowTotal -= o.price;
        (uint256 toLenders, uint256 toOwner, uint256 toOpex) = _split(o.price);
        emit Delivered(id, envelopeHash, toLenders, toOwner, toOpex);
    }

    function decline(uint256 id, uint8 reasonCode) external {
        if (msg.sender != operator) revert NotOperator();
        Order storage o = orders[id];
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        o.status = OrderStatus.Declined;
        escrowTotal -= o.price;
        token.safeTransfer(o.buyer, o.price);
        emit Declined(id, reasonCode);
    }

    function reclaim(uint256 id) external {
        Order storage o = orders[id];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        if (block.timestamp <= o.deadline) revert OrderNotExpired();
        o.status = OrderStatus.Reclaimed;
        escrowTotal -= o.price;
        token.safeTransfer(o.buyer, o.price);
        emit Reclaimed(id);
    }

    function _split(uint256 price) internal returns (uint256 toLenders, uint256 toOwner, uint256 toOpex) {
        bool trapped = state() == State.Trapped;
        uint256 owed = loan.totalOwed > repaid ? loan.totalOwed - repaid : 0;
        uint256 bps = trapped ? uint256(lenderBps) + uint256(ownerBps) : uint256(lenderBps);
        uint256 lenderShare = price * bps / BPS;
        toLenders = lenderShare < owed ? lenderShare : owed;
        toOwner = trapped ? 0 : price * ownerBps / BPS;
        toOpex = price - toLenders - toOwner;
        if (toLenders > 0) {
            repaid += toLenders;
            lenderPool += toLenders;
            accPerShare += toLenders * ACC / raised;
        }
        ownerPending += toOwner;
        opexBalance += toOpex;
    }

    // ------------------------------------------------------------ suppliers

    function paySupplier(address supplier, uint256 amount, uint256 orderId) external {
        if (msg.sender != spender) revert NotSpender();
        if (activatedAt == 0) revert WrongState();
        if (paused) revert Paused();
        Supplier memory s = suppliers[supplier];
        if (!s.allowed) revert SupplierNotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (amount > s.perTxCap) revert OverSupplierCap();
        uint64 today = uint64(block.timestamp / 1 days);
        if (today != dayIndex) {
            dayIndex = today;
            spentToday = 0;
        }
        if (spentToday + amount > dailyCap) revert OverDailyCap();
        if (amount > opexBalance) revert InsufficientOpex();
        spentToday += amount;
        opexBalance -= amount;
        token.safeTransfer(supplier, amount);
        emit SupplierPaid(supplier, amount, orderId);
    }

    // ---------------------------------------------------------------- owner

    function claimOwner() external {
        if (state() == State.Trapped) revert TrappedNoOwnerClaim();
        uint256 amount = ownerPending;
        if (amount == 0) revert ZeroAmount();
        ownerPending = 0;
        token.safeTransfer(ownerPayout, amount);
        emit OwnerClaimed(amount);
    }

    function withdrawRemainder() external {
        if (msg.sender != ownerPq) revert NotOwner();
        if (state() != State.Repaid) revert WrongState();
        uint256 amount = opexBalance;
        if (amount == 0) revert ZeroAmount();
        opexBalance = 0;
        token.safeTransfer(ownerPayout, amount);
        emit RemainderWithdrawn(amount);
    }

    // ------------------------------------------------------- policy orders

    function orderDigest(PolicyOrder calldata o) public view returns (bytes32) {
        return keccak256(abi.encode(POLICY_TAG, block.chainid, address(this), o.kind, o.target, o.value, o.nonce, o.expiry));
    }

    /// The text the owner signs (in QoreX, signArbitrary of this string).
    function orderText(PolicyOrder calldata o) public view returns (bytes memory) {
        return abi.encodePacked("qredit-order-v1:", _hex(orderDigest(o)));
    }

    /// The exact bytes the ML-DSA-87 signature covers: QoreSign's message prefix plus the text.
    function signedBytes(PolicyOrder calldata o) public view returns (bytes memory) {
        return abi.encodePacked("qorechain-msg-v1|", cosmosChainId, "|", orderText(o));
    }

    function applyOrder(PolicyOrder calldata o, bytes calldata sig) external {
        if (o.kind > uint8(Kind.RaiseDailyCap)) revert UnknownKind();
        (bool registered,, bytes memory pubkey, bool proven) = PQC_KEYS.pqcKeyStatus(ownerPq);
        if (!registered || pubkey.length == 0) revert OwnerKeyNotRegistered();
        if (!proven) revert OwnerKeyNotProven();
        if (o.nonce != policyNonce) revert BadNonce();
        if (block.timestamp > o.expiry) revert OrderExpiredSig();
        if (!PQC_VERIFY.pqcVerify(pubkey, sig, signedBytes(o))) revert BadPqcSignature();
        if (o.kind >= uint8(Kind.AddSupplier) && state() != State.Repaid) revert WideningLocked();
        policyNonce = o.nonce + 1;
        _apply(Kind(o.kind), o.target, o.value);
        emit PolicyApplied(o.nonce, o.kind, o.target, o.value);
    }

    function _apply(Kind k, address target, uint256 value) internal {
        if (k == Kind.RemoveSupplier) {
            if (!suppliers[target].allowed) revert SupplierNotAllowed();
            delete suppliers[target];
        } else if (k == Kind.LowerSupplierCap) {
            Supplier storage s = suppliers[target];
            if (!s.allowed) revert SupplierNotAllowed();
            if (value == 0 || value >= s.perTxCap) revert NotNarrowing();
            s.perTxCap = value;
        } else if (k == Kind.LowerDailyCap) {
            if (value >= dailyCap) revert NotNarrowing();
            dailyCap = value;
        } else if (k == Kind.Pause) {
            paused = true;
        } else if (k == Kind.Unpause) {
            paused = false;
        } else if (k == Kind.AddSupplier) {
            if (target == address(0) || value == 0 || suppliers[target].allowed) revert BadOrder();
            suppliers[target] = Supplier(true, value);
        } else if (k == Kind.RaiseSupplierCap) {
            Supplier storage s = suppliers[target];
            if (!s.allowed) revert SupplierNotAllowed();
            if (value <= s.perTxCap) revert BadOrder();
            s.perTxCap = value;
        } else {
            if (value <= dailyCap) revert BadOrder();
            dailyCap = value;
        }
    }

    function _hex(bytes32 d) internal pure returns (bytes memory s) {
        bytes16 alphabet = "0123456789abcdef";
        s = new bytes(66);
        s[0] = "0";
        s[1] = "x";
        for (uint256 i; i < 32; i++) {
            s[2 + 2 * i] = alphabet[uint8(d[i]) >> 4];
            s[3 + 2 * i] = alphabet[uint8(d[i]) & 0x0f];
        }
    }
}
