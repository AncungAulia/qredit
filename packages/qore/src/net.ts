import { createPublicClient, createWalletClient, defineChain, http, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Net = { chainId: string; rest: string; rpc: string };

export const TESTNET: Net & { evm: string } = {
  chainId: "qorechain-diana",
  rest: "https://api-testnet.qore.host",
  rpc: "https://rpc-testnet.qore.host",
  evm: "https://evm-testnet.qore.host",
};

export const qoreChain = (evm: string) =>
  defineChain({ id: 9800, name: "QoreChain testnet (diana)", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [evm] } } });

export const publicClientFor = (evm: string): PublicClient => createPublicClient({ chain: qoreChain(evm), transport: http(evm) }) as PublicClient;

export const walletFor = (privateKey: `0x${string}`, evm: string): WalletClient =>
  createWalletClient({ account: privateKeyToAccount(privateKey), chain: qoreChain(evm), transport: http(evm) });
