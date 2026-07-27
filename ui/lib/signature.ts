import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

export function verifyOwnerSignature(
  purpose: string,
  ownerPubkey: string,
  timestamp: number,
  signature: number[]
): boolean {
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) return false;
  try {
    const message = new TextEncoder().encode(`policy_pay-${purpose}:${ownerPubkey}:${timestamp}`);
    return nacl.sign.detached.verify(
      message,
      Uint8Array.from(signature),
      new PublicKey(ownerPubkey).toBytes()
    );
  } catch {
    return false;
  }
}
