import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import "dotenv/config";
import { GoogleGenAI, Type } from "@google/genai";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const MERCHANTS_PATH = path.join(__dirname, "merchants.json");
const AGENT_KEYPAIR_PATH = path.join(__dirname, "agent-keypair.json");

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

interface ParsedIntent {
  merchant: string;
  amount: number;
  unit: "KRW" | "SOL";
}

async function parseIntent(text: string): Promise<ParsedIntent> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const merchants = JSON.parse(fs.readFileSync(MERCHANTS_PATH, "utf-8"));
  const merchantNames = Object.keys(merchants).filter((k) => !k.startsWith("_"));

  const response = await ai.models.generateContent({
    model: "gemini-flash-latest",
    contents: `사용자의 자연어 결제 정책 요청에서 상점명, 예산 금액, 금액 단위를 추출하라.
등록된 상점 목록: ${merchantNames.join(", ")}
"원", "만원" 등은 unit=KRW, "SOL"은 unit=SOL로 표기하라. 단위 언급이 없으면 KRW로 간주하라.
요청 문장: "${text}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          merchant: { type: Type.STRING, description: "등록된 상점 목록 중 하나와 정확히 일치해야 함" },
          amount: { type: Type.NUMBER, description: "예산 금액 (unit 단위 기준)" },
          unit: { type: Type.STRING, enum: ["KRW", "SOL"] },
        },
        required: ["merchant", "amount", "unit"],
      },
    },
  });

  return JSON.parse(response.text ?? "{}");
}

async function solPerKrw(): Promise<number> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=krw");
  const data = await res.json();
  const krwPerSol = data?.solana?.krw;
  if (!krwPerSol) throw new Error("SOL/KRW 시세 조회 실패");
  return 1 / krwPerSol;
}

async function main() {
  const text = process.argv.slice(2).join(" ");
  if (!text) {
    console.error('사용법: ts-node nl-policy.ts "커피숍 결제로 한달 5만원까지 등록해줘"');
    process.exit(1);
  }

  const intent = await parseIntent(text);
  console.log("[파싱 결과]", intent);

  const merchants = JSON.parse(fs.readFileSync(MERCHANTS_PATH, "utf-8"));
  const merchantPubkeyStr = merchants[intent.merchant];
  if (!merchantPubkeyStr || merchantPubkeyStr === "REPLACE_WITH_REAL_MERCHANT_PUBKEY") {
    console.error(`[오류] 상점 "${intent.merchant}"의 지갑 주소가 merchants.json에 등록되어 있지 않습니다.`);
    process.exit(1);
  }
  const merchantPubkey = new PublicKey(merchantPubkeyStr);
  const budgetSol = intent.unit === "SOL" ? intent.amount : intent.amount * (await solPerKrw());
  const budgetLamports = new anchor.BN(Math.round(budgetSol * anchor.web3.LAMPORTS_PER_SOL));

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const owner = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idlPath = path.join(__dirname, "..", "target", "idl", "policy_pay.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new anchor.Program(idl, provider);

  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), owner.publicKey.toBuffer()],
    program.programId
  );

  const existing = await connection.getAccountInfo(policyPda);

  if (!existing) {
    // 최초 등록: 이 정책의 자동결제를 수행할 agent 키를 새로 생성해 로컬에 보관한다.
    const agent = Keypair.generate();
    fs.writeFileSync(AGENT_KEYPAIR_PATH, JSON.stringify(Array.from(agent.secretKey)));
    await program.methods
      .initializePolicy(agent.publicKey, merchantPubkey, budgetLamports)
      .accounts({ owner: owner.publicKey, policy: policyPda, systemProgram: SystemProgram.programId })
      .rpc();
    console.log(`[OK] 정책 생성 완료. agent=${agent.publicKey.toBase58()}, budget=${budgetSol.toFixed(6)} SOL, recipient=${intent.merchant}`);
  } else {
    const current = await (program.account as any).policy.fetch(policyPda);
    await program.methods
      .updatePolicy(current.agent, budgetLamports, merchantPubkey)
      .accounts({ owner: owner.publicKey, policy: policyPda })
      .rpc();
    console.log(`[OK] 정책 갱신 완료. budget=${budgetSol.toFixed(6)} SOL, recipient=${intent.merchant}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
