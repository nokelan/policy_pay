import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import { checkRateLimit } from "../../../lib/rate-limit";
import { encryptSecret } from "../../../lib/secret";
import { verifyOwnerSignature } from "../../../lib/signature";

const REPO_ROOT = path.join(process.cwd(), "..");
const CONFIG_PATH = path.join(REPO_ROOT, "app", "notify-config.json");
const IDL_PATH = path.join(REPO_ROOT, "target", "idl", "policy_pay.json");

interface ConfigEntry {
  botTokenEnc: string;
  chatId: string;
  ownerPubkey: string;
  lastTimestamp?: number;
}

function loadConfig(): Record<string, ConfigEntry> {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(config: Record<string, ConfigEntry>) {
  const tmpPath = `${CONFIG_PATH}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
  fs.renameSync(tmpPath, CONFIG_PATH);
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ownerPubkey = searchParams.get("ownerPubkey");
  const timestampStr = searchParams.get("timestamp");
  const signatureStr = searchParams.get("signature");
  if (!ownerPubkey || !timestampStr || !signatureStr) {
    return NextResponse.json(
      { error: "ownerPubkey, timestamp, signature는 필수입니다." },
      { status: 400 }
    );
  }
  if (!checkRateLimit(`notify-config:GET:${ownerPubkey}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: "요청이 너무 잦습니다. 잠시 후 다시 시도하세요." }, { status: 429 });
  }
  const timestamp = Number(timestampStr);
  let signature: number[];
  try {
    signature = JSON.parse(signatureStr);
  } catch {
    return NextResponse.json({ error: "signature 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!verifyOwnerSignature("notify-config", ownerPubkey, timestamp, signature)) {
    return NextResponse.json({ error: "지갑 서명 검증에 실패했습니다." }, { status: 401 });
  }
  let policyPda: string;
  try {
    policyPda = policyPdaFor(ownerPubkey);
  } catch {
    return NextResponse.json({ error: "ownerPubkey가 올바르지 않습니다." }, { status: 400 });
  }
  const config = loadConfig();
  const entry = config[policyPda];
  return NextResponse.json({ chatId: entry?.chatId ?? "", botConfigured: Boolean(entry?.botTokenEnc) });
}

export async function POST(request: Request) {
  const { ownerPubkey, botToken, chatId, timestamp, signature } = await request.json();
  if (!ownerPubkey || !chatId || !timestamp || !Array.isArray(signature)) {
    return NextResponse.json(
      { error: "ownerPubkey, chatId, timestamp, signature는 필수입니다." },
      { status: 400 }
    );
  }
  if (!checkRateLimit(`notify-config:POST:${ownerPubkey}`, 5, 60 * 1000)) {
    return NextResponse.json({ error: "요청이 너무 잦습니다. 잠시 후 다시 시도하세요." }, { status: 429 });
  }
  if (!verifyOwnerSignature("notify-config", ownerPubkey, timestamp, signature)) {
    return NextResponse.json({ error: "지갑 서명 검증에 실패했습니다." }, { status: 401 });
  }
  let policyPda: string;
  try {
    policyPda = policyPdaFor(ownerPubkey);
  } catch {
    return NextResponse.json({ error: "ownerPubkey가 올바르지 않습니다." }, { status: 400 });
  }
  const config = loadConfig();
  const existing = config[policyPda];
  // timestamp doubles as a nonce: once a signed timestamp is used, any
  // signature carrying that same or an older timestamp is rejected, so an
  // intercepted signature can't be replayed even inside the 5-minute window.
  if (existing?.lastTimestamp !== undefined && timestamp <= existing.lastTimestamp) {
    return NextResponse.json({ error: "이미 사용된 서명입니다." }, { status: 401 });
  }
  const resolvedBotTokenEnc = botToken ? encryptSecret(botToken) : existing?.botTokenEnc;
  if (!resolvedBotTokenEnc) {
    return NextResponse.json({ error: "botToken을 먼저 설정하세요." }, { status: 400 });
  }
  config[policyPda] = { botTokenEnc: resolvedBotTokenEnc, chatId, ownerPubkey, lastTimestamp: timestamp };
  saveConfig(config);
  return NextResponse.json({ ok: true });
}
