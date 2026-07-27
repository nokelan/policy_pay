import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const MERCHANTS_PATH = path.join(__dirname, "merchants.json");
const IDL_PATH = path.join(__dirname, "..", "target", "idl", "policy_pay.json");

// nl-policy.ts / parse-policy route.ts와 동일한 policyPda별 agent-keypair 경로 규칙.
function agentKeypairPath(policyPda: string): string {
  return path.join(__dirname, `agent-keypair-${policyPda}.json`);
}

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export async function executePayment(
  ownerPubkeyStr: string,
  merchantName: string,
  amountSolStr: string
): Promise<string> {
  const merchants = JSON.parse(fs.readFileSync(MERCHANTS_PATH, "utf-8"));
  const merchantPubkeyStr = merchants[merchantName];
  if (!merchantPubkeyStr || merchantPubkeyStr === "REPLACE_WITH_REAL_MERCHANT_PUBKEY") {
    throw new Error(`상점 "${merchantName}"의 지갑 주소가 merchants.json에 등록되어 있지 않습니다.`);
  }
  const recipient = new PublicKey(merchantPubkeyStr);
  const owner = new PublicKey(ownerPubkeyStr);
  const amountLamports = new anchor.BN(Math.round(Number(amountSolStr) * anchor.web3.LAMPORTS_PER_SOL));

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), owner.toBuffer()],
    new PublicKey(idl.address)
  );

  const keypairPath = agentKeypairPath(policyPda.toBase58());
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`이 정책(${policyPda.toBase58()})의 agent-keypair가 로컬에 없습니다: ${keypairPath}`);
  }
  const agent = loadKeypair(keypairPath);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(agent);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);

  const before = await (program.account as any).policy.fetch(policyPda);
  const allowed = (before.allowedRecipients as PublicKey[]).some((r) => r.equals(recipient));
  if (!allowed) {
    throw new Error(`"${merchantName}"(${recipient.toBase58()})은 이 정책의 허용 결제처가 아닙니다.`);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (before.validUntil.toNumber() < nowSec) {
    throw new Error(`정책 유효기간이 만료되었습니다. (validUntil=${before.validUntil.toNumber()})`);
  }
  if (amountLamports.gt(before.maxPerTx)) {
    throw new Error(`건별 한도(${before.maxPerTx.toString()} lamports)를 초과했습니다.`);
  }
  const remaining = before.budgetLimit.sub(before.spent);
  if (amountLamports.gt(remaining)) {
    throw new Error(`남은 예산(${remaining.toString()} lamports)을 초과했습니다.`);
  }

  console.log(
    `[실행] agent=${agent.publicKey.toBase58()} policy=${policyPda.toBase58()} recipient=${merchantName} amount=${amountSolStr} SOL`
  );

  const sig = await program.methods
    .policyPay(amountLamports)
    .accounts({ agent: agent.publicKey, policy: policyPda, recipient })
    .signers([agent])
    .rpc();

  console.log(`[OK] 자율결제 실행 완료. tx=${sig}`);
  return sig;
}

if (require.main === module) {
  const [ownerPubkeyStr, merchantName, amountSolStr] = process.argv.slice(2);
  if (!ownerPubkeyStr || !merchantName || !amountSolStr) {
    console.error(
      "사용법: ts-node agent-execute.ts <ownerPubkey> <merchant-name> <amountSol>\n" +
        "  실제 등록된 정책(owner)의 agent-keypair로 policyPay를 직접 실행해 자율결제를 증명한다."
    );
    process.exit(1);
  }
  executePayment(ownerPubkeyStr, merchantName, amountSolStr).catch((err) => {
    console.error(`[오류] 자율결제 실행 실패: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
