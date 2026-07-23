import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

const REPO_ROOT = path.join(process.cwd(), "..");
const CONFIG_PATH = path.join(REPO_ROOT, "app", "notify-config.json");
const IDL_PATH = path.join(REPO_ROOT, "target", "idl", "policy_pay.json");
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function loadConfig(): Record<string, { botToken: string; chatId: string; ownerPubkey: string }> {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function policyPdaFor(ownerPubkey: string): string {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const owner = new PublicKey(ownerPubkey);
  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), owner.toBuffer()],
    new PublicKey(idl.address)
  );
  return policyPda.toBase58();
}

function verifyOwnerSignature(ownerPubkey: string, timestamp: number, signature: number[]): boolean {
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) return false;
  try {
    const message = new TextEncoder().encode(`policy_pay-notify-config:${ownerPubkey}:${timestamp}`);
    return nacl.sign.detached.verify(
      message,
      Uint8Array.from(signature),
      new PublicKey(ownerPubkey).toBytes()
    );
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ownerPubkey = searchParams.get("ownerPubkey");
  if (!ownerPubkey) {
    return NextResponse.json({ error: "ownerPubkey는 필수입니다." }, { status: 400 });
  }
  let policyPda: string;
  try {
    policyPda = policyPdaFor(ownerPubkey);
  } catch {
    return NextResponse.json({ error: "ownerPubkey가 올바르지 않습니다." }, { status: 400 });
  }
  const config = loadConfig();
  const entry = config[policyPda];
  return NextResponse.json({ chatId: entry?.chatId ?? "", botConfigured: Boolean(entry?.botToken) });
}

export async function POST(request: Request) {
  const { ownerPubkey, botToken, chatId, timestamp, signature } = await request.json();
  if (!ownerPubkey || !chatId || !timestamp || !Array.isArray(signature)) {
    return NextResponse.json(
      { error: "ownerPubkey, chatId, timestamp, signature는 필수입니다." },
      { status: 400 }
    );
  }
  if (!verifyOwnerSignature(ownerPubkey, timestamp, signature)) {
    return NextResponse.json({ error: "지갑 서명 검증에 실패했습니다." }, { status: 401 });
  }
  let policyPda: string;
  try {
    policyPda = policyPdaFor(ownerPubkey);
  } catch {
    return NextResponse.json({ error: "ownerPubkey가 올바르지 않습니다." }, { status: 400 });
  }
  const config = loadConfig();
  const resolvedBotToken = botToken || config[policyPda]?.botToken;
  if (!resolvedBotToken) {
    return NextResponse.json({ error: "botToken을 먼저 설정하세요." }, { status: 400 });
  }
  config[policyPda] = { botToken: resolvedBotToken, chatId, ownerPubkey };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return NextResponse.json({ ok: true });
}
