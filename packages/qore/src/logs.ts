/** Default span of one eth_getLogs request; the node rejects wider ranges. */
export const LOG_CHUNK_BLOCKS = 2_000;

/** Inclusive [from, to] windows of at most `chunk` blocks covering from..to. Empty when from > to. */
export function blockRanges(from: number, to: number, chunk = LOG_CHUNK_BLOCKS): [number, number][] {
  if (!Number.isInteger(chunk) || chunk < 1) throw new Error("chunk must be a positive integer");
  const out: [number, number][] = [];
  for (let start = from; start <= to; start += chunk) out.push([start, Math.min(start + chunk - 1, to)]);
  return out;
}

/** Run `fetchRange` over every chunk of from..to, in order, and concatenate the results. */
export async function scanChunked<T>(
  from: number, to: number, fetchRange: (from: bigint, to: bigint) => Promise<T[]>, chunk = LOG_CHUNK_BLOCKS,
): Promise<T[]> {
  const out: T[] = [];
  for (const [a, b] of blockRanges(from, to, chunk)) out.push(...(await fetchRange(BigInt(a), BigInt(b))));
  return out;
}
