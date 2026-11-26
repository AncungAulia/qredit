import { parseAbi, toFunctionSelector } from "viem";

/** The v2 factory (vault v2 spec): fixed fUSD token and the owner's bond. Deploy tx and block: sc/README.md. */
export const FACTORY_ADDRESS = "0xa960E225a56D787F72346d740d39F35ab43814D0" as const;
/** Block of the v2 factory deployment; no v2 factory log can exist before it. */
export const FACTORY_START_BLOCK = 10_772_909;
/** The v1 factory and its vaults stay on chain untouched; apps read them only for old orders and positions. */
export const FACTORY_V1_ADDRESS = "0xAc5324088A7735dda922c277db5A2E906c8f5b3A" as const;
/** Block of the v1 factory deployment tx 0x11a99af52774dca850678ffd9c344012339aa7c19e11f88b60571676d70bd2af. */
export const FACTORY_V1_START_BLOCK = 10_667_776;
export const FUSD_ADDRESS = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
export const FUSD_DENOM = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";

/** Which LoanVault build a vault runs. The backend stores it per business. */
export type VaultVersion = 1 | 2;

/** LoanVault.BOND_BPS: the owner's bond in basis points of the loan target. */
export const BOND_BPS = 1000n;
/** LoanVault.REVIEW_WINDOW: how long a buyer may reject a delivered report, in seconds. */
export const REVIEW_WINDOW_SECONDS = 86_400;
/** The bond the v2 factory pulls from the creator for a loan target (fUSD units). */
export const bondFor = (target: bigint): bigint => (target * BOND_BPS) / 10_000n;

/** The events of a v2 vault that the apps read. */
export const VAULT_EVENTS = parseAbi([
  "event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline)",
  "event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 reviewEnds)",
  "event Settled(uint256 indexed orderId, uint256 toLenders, uint256 toOwner, uint256 toOpex)",
  "event Rejected(uint256 indexed orderId, uint256 refund, uint256 cost)",
  "event Declined(uint256 indexed orderId, uint8 reasonCode)",
  "event Reclaimed(uint256 indexed orderId)",
  "event LoanEnded(uint8 kind)",
  "event AgentRotated(address spender, address operator)",
]);

/** The order events of a v1 vault: Delivered still carries the split. */
export const VAULT_EVENTS_V1 = parseAbi([
  "event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline)",
  "event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 toLenders, uint256 toOwner, uint256 toOpex)",
  "event Declined(uint256 indexed orderId, uint8 reasonCode)",
  "event Reclaimed(uint256 indexed orderId)",
]);

export const SUPPLIER_PAID_EVENT = parseAbi(["event SupplierPaid(address indexed supplier, uint256 amount, uint256 indexed orderId)"]);

export const VAULT_ABI = parseAbi([
  "struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; uint64 maturity; uint64 maturityGrace; uint16 defaultAfterMissed; }",
  "struct Init { address spender; address operator; address ownerPq; address ownerPayout; string cosmosChainId; uint16 lenderBps; uint16 ownerBps; uint256 dailyCap; uint64 orderTtl; LoanTerms loan; address[] suppliers; uint256[] supplierCaps; uint256[] servicePrices; }",
  "function deposit(uint256 amount)",
  "function buy(uint256 serviceId, bytes32 requestRef) returns (uint256)",
  "function deliver(uint256 orderId, bytes32 envelopeHash)",
  "function decline(uint256 orderId, uint8 reasonCode)",
  "function accept(uint256 orderId)",
  "function settle(uint256 orderId)",
  "function reject(uint256 orderId)",
  "function triggerDefault()",
  "function paySupplier(address supplier, uint256 amount, uint256 orderId)",
  "function claimLender()",
  "function state() view returns (uint8)",
  "function defaultable() view returns (bool)",
  "function raised() view returns (uint256)",
  "function repaid() view returns (uint256)",
  "function opexBalance() view returns (uint256)",
  "function bondHeld() view returns (uint256)",
  "function swept() view returns (uint256)",
  "function loan() view returns (uint256 target, uint256 totalOwed, uint64 raiseDeadline, uint64 period, uint64 grace, uint256 installment, uint64 maturity, uint64 maturityGrace, uint16 defaultAfterMissed)",
  "function orders(uint256 orderId) view returns (address buyer, uint32 serviceId, uint64 deadline, uint8 status, uint256 price, bytes32 requestRef, uint64 reviewEnds)",
  "function supplierCost(uint256 orderId) view returns (uint256)",
  "function servicePrice(uint256 serviceId) view returns (uint256)",
  "function serviceCount() view returns (uint256)",
  "function spender() view returns (address)",
  "function operator() view returns (address)",
  "function ownerPq() view returns (address)",
  "function paused() view returns (bool)",
  "function dailyCap() view returns (uint256)",
  "function spentToday() view returns (uint256)",
  "function dayIndex() view returns (uint64)",
  "function suppliers(address) view returns (bool allowed, uint256 perTxCap)",
  "error OrderNotOpen()",
  "error OrderExpired()",
  "error NotOperator()",
  "error NotInReview()",
  "error ReviewOpen()",
]);

export const FACTORY_ABI = parseAbi([
  "struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; uint64 maturity; uint64 maturityGrace; uint16 defaultAfterMissed; }",
  "struct Init { address spender; address operator; address ownerPq; address ownerPayout; string cosmosChainId; uint16 lenderBps; uint16 ownerBps; uint256 dailyCap; uint64 orderTtl; LoanTerms loan; address[] suppliers; uint256[] supplierCaps; uint256[] servicePrices; }",
  "function create(Init init) returns (address)",
  "function count() view returns (uint256)",
  "function token() view returns (address)",
  "event VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index)",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const PAY_SUPPLIER_SELECTOR = toFunctionSelector("paySupplier(address,uint256,uint256)");

/** LoanVault.State, in declaration order. Defaulted and Closed exist only in v2 vaults. */
export const VAULT_STATE = { Raising: 0, Active: 1, Trapped: 2, Repaid: 3, Refunded: 4, Defaulted: 5, Closed: 6 } as const;

/** LoanVault.OrderStatus of a v2 vault, in declaration order. */
export const ORDER_STATUS = { None: 0, Open: 1, InReview: 2, Settled: 3, Rejected: 4, Declined: 5, Reclaimed: 6 } as const;
