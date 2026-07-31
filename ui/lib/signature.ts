import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

async function hashPayload(payload: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical) as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// payload가 주어지면 서명 메시지에 그 내용의 해시를 바인딩해, 서명을 가로채도
// 다른 값(예: chatId)으로 바꿔치기한 요청을 통과시킬 수 없게 한다.
export async function buildSignedMessage(
  purpose: string,
  ownerPubkey: string,
  timestamp: number,
  payload?: Record<string, unknown>
): Promise<string> {
  const suffix = payload ? `:${await hashPayload(payload)}` : "";
  return `policy_pay-${purpose}:${ownerPubkey}:${timestamp}${suffix}`;
}

export async function verifyOwnerSignature(
  purpose: string,
  ownerPubkey: string,
  timestamp: number,
  signature: number[],
  payload?: Record<string, unknown>
): Promise<boolean> {
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) return false;
  try {
    const message = new TextEncoder().encode(await buildSignedMessage(purpose, ownerPubkey, timestamp, payload));
    return nacl.sign.detached.verify(
      message,
      Uint8Array.from(signature),
      new PublicKey(ownerPubkey).toBytes()
    );
  } catch {
    return false;
  }
}
