// Minimal protobuf type for cosmos.evm.erc20.v1.MsgConvertCoin (the SDK registry does not ship it).
import { BinaryReader, BinaryWriter } from "cosmjs-types/binary";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";
import type { EncodeObject, GeneratedType, Registry } from "@cosmjs/proto-signing";
import { qorechainRegistry } from "@qorechain/sdk";
import { FUSD_DENOM } from "./abi.ts";

export const MSG_CONVERT_COIN = "/cosmos.evm.erc20.v1.MsgConvertCoin";
export interface MsgConvertCoin { coin?: Coin; receiver: string; sender: string }

export const MsgConvertCoinType = {
  encode(m: MsgConvertCoin, w: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (m.coin) Coin.encode(m.coin, w.uint32(10).fork()).ldelim();
    if (m.receiver) w.uint32(18).string(m.receiver);
    if (m.sender) w.uint32(26).string(m.sender);
    return w;
  },
  decode(input: Uint8Array | BinaryReader, length?: number): MsgConvertCoin {
    const r = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? r.len : r.pos + length;
    const m: MsgConvertCoin = { receiver: "", sender: "" };
    while (r.pos < end) {
      const tag = r.uint32();
      switch (tag >>> 3) {
        case 1: m.coin = Coin.decode(r, r.uint32()); break;
        case 2: m.receiver = r.string(); break;
        case 3: m.sender = r.string(); break;
        default: r.skipType(tag & 7);
      }
    }
    return m;
  },
  fromPartial(o: Partial<MsgConvertCoin>): MsgConvertCoin {
    return { coin: o.coin ? Coin.fromPartial(o.coin) : undefined, receiver: o.receiver ?? "", sender: o.sender ?? "" };
  },
} satisfies GeneratedType;

/** Bank coin to ERC-20 for the same account (hybrid-signed by the sender). */
export function convertCoinMsg(senderQor: string, receiverHex: string, units: bigint): EncodeObject {
  return {
    typeUrl: MSG_CONVERT_COIN,
    value: { coin: { denom: FUSD_DENOM, amount: units.toString() }, receiver: receiverHex, sender: senderQor },
  };
}

/** The SDK registry plus the types the SDK does not ship. */
export const qoreRegistry = (): Registry => qorechainRegistry([[MSG_CONVERT_COIN, MsgConvertCoinType]]);
