import { parseAbi, toFunctionSelector } from "viem";

export const FACTORY_ADDRESS = "0xAc5324088A7735dda922c277db5A2E906c8f5b3A" as const;
export const FUSD_ADDRESS = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
export const FUSD_DENOM = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";

export const VAULT_EVENTS = parseAbi([
  "event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline)",
  "event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 toLenders, uint256 toOwner, uint256 toOpex)",
  "event Declined(uint256 indexed orderId, uint8 reasonCode)",
  "event Reclaimed(uint256 indexed orderId)",
]);

export const SUPPLIER_PAID_EVENT = parseAbi(["event SupplierPaid(address indexed supplier, uint256 amount, uint256 indexed orderId)"]);

export const VAULT_ABI = parseAbi([
  "struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; }",
  "struct Init { address token; address spender; address operator; address ownerPq; address ownerPayout; string cosmosChainId; uint16 lenderBps; uint16 ownerBps; uint256 dailyCap; uint64 orderTtl; LoanTerms loan; address[] suppliers; uint256[] supplierCaps; uint256[] servicePrices; }",
  "function deposit(uint256 amount)",
  "function buy(uint256 serviceId, bytes32 requestRef) returns (uint256)",
  "function deliver(uint256 orderId, bytes32 envelopeHash)",
  "function decline(uint256 orderId, uint8 reasonCode)",
  "function paySupplier(address supplier, uint256 amount, uint256 orderId)",
  "function claimLender()",
  "function state() view returns (uint8)",
  "function raised() view returns (uint256)",
  "function repaid() view returns (uint256)",
  "function opexBalance() view returns (uint256)",
  "function servicePrice(uint256 serviceId) view returns (uint256)",
  "function serviceCount() view returns (uint256)",
  "function spender() view returns (address)",
  "function operator() view returns (address)",
  "function ownerPq() view returns (address)",
]);

export const FACTORY_ABI = parseAbi([
  "struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; }",
  "struct Init { address token; address spender; address operator; address ownerPq; address ownerPayout; string cosmosChainId; uint16 lenderBps; uint16 ownerBps; uint256 dailyCap; uint64 orderTtl; LoanTerms loan; address[] suppliers; uint256[] supplierCaps; uint256[] servicePrices; }",
  "function create(Init init) returns (address)",
  "function count() view returns (uint256)",
  "event VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index)",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const PAY_SUPPLIER_SELECTOR = toFunctionSelector("paySupplier(address,uint256,uint256)");
