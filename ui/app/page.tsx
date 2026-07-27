"use client";

import { useEffect, useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

interface ParseResult {
  action: "initialize" | "update";
  policyPda: string;
  merchant: string;
  merchantPubkey: string;
  recipientAlreadyAllowed?: boolean;
  budgetLamports: string;
  budgetSol: number;
  agentPubkey: string;
  maxPerTxLamports: string;
  validUntil: number;
}

export default function Home() {
  const { publicKey, signMessage } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();

  const [text, setText] = useState("");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [botConfigured, setBotConfigured] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState("");

  useEffect(() => {
    if (!publicKey || !signMessage) return;
    (async () => {
      const ownerPubkey = publicKey.toBase58();
      const timestamp = Date.now();
      const message = `policy_pay-notify-config:${ownerPubkey}:${timestamp}`;
      const signature = await signMessage(new TextEncoder().encode(message));
      const params = new URLSearchParams({
        ownerPubkey,
        timestamp: String(timestamp),
        signature: JSON.stringify(Array.from(signature)),
      });
      const res = await fetch(`/api/notify-config?${params.toString()}`);
      const data = await res.json();
      setChatId(data.chatId ?? "");
      setBotConfigured(Boolean(data.botConfigured));
    })();
  }, [publicKey, signMessage]);

  async function handleSaveNotifyConfig() {
    if (!publicKey) return;
    if (!signMessage) {
      setNotifyStatus("이 지갑은 메시지 서명을 지원하지 않습니다.");
      return;
    }
    if (!chatId) return;

    setNotifyStatus("지갑 서명 대기 중...");
    try {
      const ownerPubkey = publicKey.toBase58();
      const timestamp = Date.now();
      const message = `policy_pay-notify-config:${ownerPubkey}:${timestamp}`;
      const signature = await signMessage(new TextEncoder().encode(message));

      setNotifyStatus("저장 중...");
      const res = await fetch("/api/notify-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPubkey,
          botToken: botToken || undefined,
          chatId,
          timestamp,
          signature: Array.from(signature),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBotToken("");
        setBotConfigured(true);
        setNotifyStatus("저장됨");
      } else {
        setNotifyStatus(`오류: ${data.error}`);
      }
    } catch (err) {
      setNotifyStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleSubmit() {
    if (!publicKey || !anchorWallet) {
      setStatus("먼저 지갑을 연결하세요.");
      return;
    }
    if (!signMessage) {
      setStatus("이 지갑은 메시지 서명을 지원하지 않습니다.");
      return;
    }
    if (!text.trim()) return;

    setBusy(true);
    setStatus("정책 해석 중...");

    try {
      const ownerPubkey = publicKey.toBase58();
      const timestamp = Date.now();
      const message = `policy_pay-parse-policy:${ownerPubkey}:${timestamp}`;
      const signature = await signMessage(new TextEncoder().encode(message));

      const parseRes = await fetch("/api/parse-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          ownerPubkey,
          timestamp,
          signature: Array.from(signature),
        }),
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
      const maxPerTxLamports = new anchor.BN(parsed.maxPerTxLamports);
      const validUntil = new anchor.BN(parsed.validUntil);

      setStatus(`${parsed.action === "initialize" ? "정책 생성" : "정책 갱신"} 트랜잭션 서명 대기 중...`);

      let sig: string;
      if (parsed.action === "initialize") {
        sig = await program.methods
          .initializePolicy(agentPubkey, [merchantPubkey], budgetLamports, maxPerTxLamports, validUntil)
          .accounts({ owner: publicKey, policy: policyPda, systemProgram: SystemProgram.programId })
          .rpc();
      } else {
        if (!parsed.recipientAlreadyAllowed) {
          await program.methods
            .addRecipient(merchantPubkey)
            .accounts({ owner: publicKey, policy: policyPda })
            .rpc();
        }
        sig = await program.methods
          .updatePolicy(agentPubkey, budgetLamports, maxPerTxLamports, validUntil)
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

      <div className="w-full flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-medium">결제 알림 봇 설정</h2>
        <input
          type="password"
          className="w-full border rounded p-2"
          placeholder={botConfigured ? "설정됨 (변경하려면 새 토큰 입력)" : "Telegram Bot Token"}
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
        />
        <input
          className="w-full border rounded p-2"
          placeholder="Telegram Chat ID"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
        />
        <button
          className="border rounded py-2 disabled:opacity-50"
          disabled={!publicKey || !chatId || (!botToken && !botConfigured)}
          onClick={handleSaveNotifyConfig}
        >
          알림 봇 저장
        </button>
        {notifyStatus && <p className="text-sm">{notifyStatus}</p>}
      </div>
    </main>
  );
}
