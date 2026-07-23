import crypto from "crypto";

function getKey(): Buffer {
  const hex = process.env.NOTIFY_CONFIG_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("NOTIFY_CONFIG_KEY 환경변수가 설정되지 않았습니다(32바이트 hex 필요).");
  }
  return Buffer.from(hex, "hex");
}

export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}
