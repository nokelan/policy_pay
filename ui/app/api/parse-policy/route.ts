import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const REPO_ROOT = path.join(process.cwd(), "..");
const MERCHANTS_PATH = path.join(REPO_ROOT, "app", "merchants.json");
const AGENT_KEYPAIR_PATH = path.join(REPO_ROOT, "app", "agent-keypair.json");
const IDL_PATH = path.join(REPO_ROOT, "target", "idl", "policy_pay.json");

interface ParsedIntent {
  merchant: string;
  amount: number;
  unit: "KRW" | "SOL";
}

async function parseIntent(text: string, merchantNames: string[]): Promise<ParsedIntent> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

export async function POST(request: Request) {
  const { text, ownerPubkey } = await request.json();
  if (!text || !ownerPubkey) {
    return NextResponse.json({ error: "text, ownerPubkey는 필수입니다." }, { status: 400 });
  }

  const merchants = JSON.parse(fs.readFileSync(MERCHANTS_PATH, "utf-8"));
  const merchantNames = Object.keys(merchants).filter((k) => !k.startsWith("_"));

  const intent = await parseIntent(text, merchantNames);

  const merchantPubkeyStr = merchants[intent.merchant];
  if (!merchantPubkeyStr || merchantPubkeyStr === "REPLACE_WITH_REAL_MERCHANT_PUBKEY") {
    return NextResponse.json(
      { error: `상점 "${intent.merchant}"의 지갑 주소가 merchants.json에 등록되어 있지 않습니다.` },
      { status: 400 }
    );
  }

  const budgetSol = intent.unit === "SOL" ? intent.amount : intent.amount * (await solPerKrw());
  const budgetLamports = new anchor.BN(Math.round(budgetSol * anchor.web3.LAMPORTS_PER_SOL));

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const owner = new PublicKey(ownerPubkey);

  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), owner.toBuffer()],
    new PublicKey(idl.address)
  );

  const existing = await connection.getAccountInfo(policyPda);

  if (!existing) {
    const agent = Keypair.generate();
    fs.writeFileSync(AGENT_KEYPAIR_PATH, JSON.stringify(Array.from(agent.secretKey)));
    return NextResponse.json({
      action: "initialize",
      policyPda: policyPda.toBase58(),
      merchant: intent.merchant,
      merchantPubkey: merchantPubkeyStr,
      budgetLamports: budgetLamports.toString(),
      budgetSol,
      agentPubkey: agent.publicKey.toBase58(),
    });
  }

  const dummyKeypair = Keypair.generate();
  const readonlyWallet = {
    publicKey: dummyKeypair.publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
  };
  const readonlyProvider = new anchor.AnchorProvider(connection, readonlyWallet as anchor.Wallet, {
    commitment: "confirmed",
  });
  const program = new anchor.Program(idl, readonlyProvider);
  const current = await (program.account as any).policy.fetch(policyPda);

  return NextResponse.json({
    action: "update",
    policyPda: policyPda.toBase58(),
    merchant: intent.merchant,
    merchantPubkey: merchantPubkeyStr,
    budgetLamports: budgetLamports.toString(),
    budgetSol,
    agentPubkey: current.agent.toBase58(),
  });
}
