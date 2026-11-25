import { evmWindowStatus } from "@qorechain/evm";
import { fetchAuthenticators, fetchPqcStatus, fetchSpendingRules } from "@qorechain/sdk";
import {
  ERC20_ABI,
  FACTORY_ADDRESS,
  FACTORY_RUNTIME_CODEHASH,
  FUSD_ADDRESS,
  hexToQor,
  LOAN_VAULT_ABI,
  PAY_SUPPLIER_SELECTOR,
  VAULT_FACTORY_ABI,
} from "@qredit/qore";
import { keccak256 } from "viem";
import { vaultStateName } from "@/components/shared/StateBadge";
import { publicClient, restUrl } from "@/lib/chain";
import type { Business } from "@/lib/schemas";
import {
  judgeBooks,
  judgeFactory,
  judgeOperatorWindow,
  judgeOwnerKey,
  judgeSpenderRule,
  judgeWidening,
  UNKNOWN_DETAIL,
  type CheckId,
  type CheckResult,
} from "@/modules/proof/checks";

type Hex = `0x${string}`;

/** The hash of the code deployed at the factory address. It never changes, so callers cache it for good. */
export async function readFactoryCodeHash(): Promise<string> {
  const code = await publicClient.getCode({ address: FACTORY_ADDRESS });
  if (!code) throw new Error("No code at the factory address");
  return keccak256(code);
}

/** The vaults the factory lists, lower-cased. Shared by every business. */
export async function readFactoryVaults(): Promise<string[]> {
  const all = (await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: VAULT_FACTORY_ABI,
    functionName: "all",
  })) as readonly string[];
  return all.map((v) => v.toLowerCase());
}

export type ProofReads = {
  codeHash: () => Promise<string>;
  vaults: () => Promise<string[]>;
};

/** A check that cannot run becomes "unknown"; it is never read as a pass. */
const guard = async (id: CheckId, run: () => Promise<CheckResult>): Promise<CheckResult> => {
  try {
    return await run();
  } catch {
    return { id, status: "unknown", detail: UNKNOWN_DETAIL };
  }
};

const readVault = <T>(address: Hex, functionName: string) =>
  publicClient.readContract({ address, abi: LOAN_VAULT_ABI, functionName } as never) as Promise<T>;

/** Runs the six checks of one business against the chain. Each check is isolated; this never rejects. */
export function runChecks(
  b: Business,
  reads: ProofReads = { codeHash: readFactoryCodeHash, vaults: readFactoryVaults },
): Promise<CheckResult[]> {
  const vault = b.vault;
  const rest = restUrl();
  const factory = guard("factory", async () => {
    const [vaults, codeHash] = await Promise.all([reads.vaults(), reads.codeHash()]);
    return judgeFactory(vaults.includes(vault), codeHash, FACTORY_RUNTIME_CODEHASH);
  });
  return Promise.all([
    factory,
    guard("ownerKey", async () => {
      const ownerPq = await readVault<Hex>(vault, "ownerPq");
      return judgeOwnerKey(await fetchPqcStatus({ rest, address: hexToQor(ownerPq) }));
    }),
    guard("spenderRule", async () => {
      const address = hexToQor(b.spender);
      const [keys, stored] = await Promise.all([
        fetchAuthenticators({ rest, address }),
        fetchSpendingRules({ rest, address }),
      ]);
      return judgeSpenderRule({ keys, ...stored }, vault, PAY_SUPPLIER_SELECTOR);
    }),
    guard("operatorWindow", async () =>
      judgeOperatorWindow(await evmWindowStatus({ rest, address: hexToQor(b.operator) }), vault),
    ),
    guard("books", async () => {
      const [books, balance] = await Promise.all([
        readVault<readonly bigint[]>(vault, "books"),
        publicClient.readContract({
          address: FUSD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [vault],
        }) as Promise<bigint>,
      ]);
      return judgeBooks(books, balance);
    }),
    guard("widening", async () =>
      judgeWidening(vaultStateName(Number(await readVault<number>(vault, "state"))), await factory),
    ),
  ]);
}
