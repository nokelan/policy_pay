"use client";

import { useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

interface ParseResult {
  action: "initialize" | "update";
  policyPda: string;
  merchant: string;
  merchantPubkey: string;
  budgetLamports: string;
  budgetSol: number;
  agentPubkey: string;
}

export default function Home() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();

  const [text, setText] = useState("");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!publicKey || !anchorWallet) {
      setStatus("먼저 지갑을 연결하세요.");
      return;
    }
    if (!text.trim()) return;

    setBusy(true);
    setStatus("정책 해석 중...");

    try {
      const parseRes = await fetch("/api/parse-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ownerPubkey: publicKey.toBase58() }),
      });
      const parsed: ParseResult & { error?: string } = await parseRes.json();
      if (!parseRes.ok) {
        setStatus(`오류: ${parsed.error}`);
        return;
      }

      const idlRes = await fetch("/api/idl");
      const idl = await idlRes.json();

      const provider = new anchor.AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
      const program = new anchor.Program(idl, provider);

      const policyPda = new PublicKey(parsed.policyPda);
      const agentPubkey = new PublicKey(parsed.agentPubkey);
      const merchantPubkey = new PublicKey(parsed.merchantPubkey);
      const budgetLamports = new anchor.BN(parsed.budgetLamports);

      setStatus(`${parsed.action === "initialize" ? "정책 생성" : "정책 갱신"} 트랜잭션 서명 대기 중...`);

      let sig: string;
      if (parsed.action === "initialize") {
        sig = await program.methods
          .initializePolicy(agentPubkey, merchantPubkey, budgetLamports)
          .accounts({ owner: publicKey, policy: policyPda, systemProgram: SystemProgram.programId })
          .rpc();
      } else {
        sig = await program.methods
          .updatePolicy(agentPubkey, budgetLamports, merchantPubkey)
          .accounts({ owner: publicKey, policy: policyPda })
          .rpc();
      }

      setStatus(
        `완료 (${parsed.merchant}, ${parsed.budgetSol.toFixed(6)} SOL). tx: ${sig.slice(0, 12)}...`
      );
      setText("");
    } catch (err) {
      setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 flex flex-col items-center gap-8 p-8 pt-24 max-w-xl mx-auto w-full">
      <h1 className="text-2xl font-semibold">Allowance</h1>
      <WalletMultiButton />

      <div className="w-full flex flex-col gap-3">
        <textarea
          className="w-full border rounded p-3 min-h-24"
          placeholder='예: "커피숍 결제로 한달 5만원까지 등록해줘"'
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="border rounded py-2 disabled:opacity-50"
          disabled={busy || !text.trim()}
          onClick={handleSubmit}
        >
          {busy ? "처리 중..." : "정책 등록/갱신"}
        </button>
        {status && <p className="text-sm whitespace-pre-wrap">{status}</p>}
      </div>
    </main>
  );
}
