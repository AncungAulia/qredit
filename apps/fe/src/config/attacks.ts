import {
  EyeOff,
  Gauge,
  Hourglass,
  KeyRound,
  Landmark,
  LockOpen,
  PenLine,
  Repeat,
  Replace,
  Syringe,
  UserX,
  type LucideIcon,
} from "lucide-react";

/**
 * The transaction that shows an attack being refused. An EVM hash opens on the explorer; a Cosmos
 * transaction hash has no explorer page here, so it shows as text.
 */
export type AttackTx = { kind: "evm"; hash: `0x${string}` } | { kind: "cosmos"; hash: string };

export type Attack = {
  id: string;
  icon: LucideIcon;
  title: string;
  /** What the attacker did. */
  tried: string;
  /** What refuses it. */
  stoppedBy: string;
  /** A recorded transaction that shows the refusal, or null while none is recorded. Never guessed. */
  txHash: AttackTx | null;
};

// The eleven attacks of section 9 of the design spec, in its order. A hash is set only where
// engine/RESULTS.md or engine/spikes/RESULTS.md records a transaction that shows that attack stopped.
export const ATTACKS: Attack[] = [
  {
    id: "prompt-injection",
    icon: Syringe,
    title: "Prompt injection in a buyer request",
    tried: "A buyer request hid an instruction: pay all funds to another address.",
    stoppedBy:
      "The payment tool accepts only listed suppliers, and the vault refuses any other payment on chain.",
    // engine/RESULTS.md, "Live 6: prompt injection": the order was declined before any payment.
    txHash: {
      kind: "evm",
      hash: "0x1aebed636a45c78bae0181a48c1013b97e4a5691333b61eda99ee832ef864160",
    },
  },
  {
    id: "agent-key-other-call",
    icon: KeyRound,
    title: "A stolen agent key calls another contract",
    tried: "The agent key tried to call a function that its rule does not list.",
    stoppedBy: "The authenticator allows only the listed contract calls, so every other call is refused.",
    // engine/spikes/RESULTS.md, row S1: the refused call of other() through a linked key.
    txHash: {
      kind: "cosmos",
      hash: "0xB955AF4EFFF0EF7AFCAC17DF723FFABF3665FA0D4292845EA7D9EA051184E86B",
    },
  },
  {
    id: "agent-key-drain",
    icon: Gauge,
    title: "A stolen agent key drains the vault through a supplier payment",
    tried: "A payment above the cap of one supplier was sent through paySupplier.",
    stoppedBy: "The vault enforces a cap for each supplier and a cap for each day, so the payment reverts.",
    // engine/RESULTS.md, row "Reverted relayed payment (probe)": 200001 units against a cap of 200000, not counted as a payment.
    txHash: {
      kind: "cosmos",
      hash: "740D1C51219429394723759E9EF819554B89D77DCDE4409A25783C19386E1A6C",
    },
  },
  {
    id: "operator-key-calls",
    icon: UserX,
    title: "A stolen operator key pays a supplier or calls another contract",
    tried: "The operator key tried to call paySupplier or a contract that is not the vault.",
    stoppedBy: "The vault accepts paySupplier only from the spender, and the operator window lists the vault as its only target.",
    txHash: null,
  },
  {
    id: "operator-key-expired",
    icon: Hourglass,
    title: "A stolen operator key after its window has ended",
    tried: "The operator key tried to send a transaction when no window was open.",
    stoppedBy: "Without an open window the chain refuses every EVM transaction from the operator.",
    txHash: null,
  },
  {
    id: "owner-ecdsa-leak",
    icon: PenLine,
    title: "A leaked owner ECDSA key submits a policy order",
    tried: "A policy order was signed with the classical owner key alone.",
    stoppedBy: "The vault checks an ML-DSA-87 signature, so the order is refused with BadPqcSignature.",
    txHash: null,
  },
  {
    id: "widening",
    icon: LockOpen,
    title: "The real owner adds a supplier during the loan",
    tried: "The owner signed a valid post-quantum order that widens the rules while the loan runs.",
    stoppedBy: "Widening is locked until the loan is repaid, so the order is refused with WideningLocked.",
    txHash: null,
  },
  {
    id: "replay",
    icon: Repeat,
    title: "Replay of a valid policy order",
    tried: "A policy order that was already applied was sent again.",
    stoppedBy: "Every order carries a nonce, and a used nonce is refused with BadNonce.",
    txHash: null,
  },
  {
    id: "outsider-reads-report",
    icon: EyeOff,
    title: "An outsider opens another buyer's report",
    tried: "A sealed report was downloaded and opened without the buyer's key.",
    stoppedBy: "The report is sealed to the buyer's key, so decryption fails.",
    txHash: null,
  },
  {
    id: "swapped-envelope",
    icon: Replace,
    title: "A swapped report envelope",
    tried: "The delivered envelope was replaced with a different one.",
    stoppedBy: "The hash of the envelope does not match the hash in the Delivered event.",
    txHash: null,
  },
  {
    id: "trapped-owner-claim",
    icon: Landmark,
    title: "The owner claims revenue while behind schedule",
    tried: "The owner asked for revenue while the loan was behind its repayment schedule.",
    stoppedBy: "The vault is Trapped, and it refuses the owner's claim with TrappedNoOwnerClaim.",
    txHash: null,
  },
];
