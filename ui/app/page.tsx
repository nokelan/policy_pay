"use client";

import { useEffect, useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { buildSignedMessage } from "../lib/signature";

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
  const [pendingParse, setPendingParse] = useState<ParseResult | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [botConfigured, setBotConfigured] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState("");

  const [depositAmount, setDepositAmount] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositStatus, setDepositStatus] = useState("");
  const [depositTxSig, setDepositTxSig] = useState<string | null>(null);

  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  const [closeBusy, setCloseBusy] = useState(false);
  const [closeStatus, setCloseStatus] = useState("");
  const [closeTxSig, setCloseTxSig] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setWalletBalance(null);
      return;
    }
    let cancelled = false;
    async function fetchBalance() {
      const lamports = await connection.getBalance(publicKey!);
      if (!cancelled) setWalletBalance(lamports / anchor.web3.LAMPORTS_PER_SOL);
    }
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicKey, connection]);

  useEffect(() => {
    if (!publicKey || !signMessage) return;
    (async () => {
      const ownerPubkey = publicKey.toBase58();
      const timestamp = Date.now();
      const message = await buildSignedMessage("notify-config:read", ownerPubkey, timestamp);
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
      const message = await buildSignedMessage("notify-config:write", ownerPubkey, timestamp, {
        chatId,
        botToken: botToken || null,
      });
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
    setTxSig(null);

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

      setPendingParse(parsed);
      setStatus("");
    } catch (err) {
      setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function handleCancelConfirm() {
    setPendingParse(null);
    setStatus("");
  }

  async function handleConfirm() {
    if (!publicKey || !anchorWallet || !pendingParse) return;
    const parsed = pendingParse;

    setBusy(true);
    try {
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

      setStatus(`완료 (${parsed.merchant}, ${parsed.budgetSol.toFixed(6)} SOL)`);
      setTxSig(sig);
      setText("");
      setPendingParse(null);
    } catch (err) {
      setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeposit() {
    if (!publicKey || !anchorWallet) {
      setDepositStatus("먼저 지갑을 연결하세요.");
      return;
    }
    const sol = Number(depositAmount);
    if (!sol || sol <= 0) return;

    setDepositBusy(true);
    setDepositStatus("트랜잭션 서명 대기 중...");
    setDepositTxSig(null);

    try {
      const idlRes = await fetch("/api/idl");
      const idl = await idlRes.json();

      const provider = new anchor.AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
      const program = new anchor.Program(idl, provider);

      const [policyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), publicKey.toBuffer()],
        program.programId
      );
      const amountLamports = new anchor.BN(Math.round(sol * anchor.web3.LAMPORTS_PER_SOL));

      const sig = await program.methods
        .deposit(amountLamports)
        .accounts({ owner: publicKey, policy: policyPda, systemProgram: SystemProgram.programId })
        .rpc();

      setDepositStatus(`예치 완료 (${sol} SOL)`);
      setDepositTxSig(sig);
      setDepositAmount("");
      connection.getBalance(publicKey).then((l) => setWalletBalance(l / anchor.web3.LAMPORTS_PER_SOL));
    } catch (err) {
      setDepositStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDepositBusy(false);
    }
  }

  async function handleClosePolicy() {
    if (!publicKey || !anchorWallet) {
      setCloseStatus("먼저 지갑을 연결하세요.");
      return;
    }
    if (!window.confirm("정책을 종료하고 Vault의 모든 잔액을 지갑으로 반환합니다. 계속할까요?")) return;

    setCloseBusy(true);
    setCloseStatus("트랜잭션 서명 대기 중...");
    setCloseTxSig(null);

    try {
      const idlRes = await fetch("/api/idl");
      const idl = await idlRes.json();

      const provider = new anchor.AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
      const program = new anchor.Program(idl, provider);

      const [policyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), publicKey.toBuffer()],
        program.programId
      );

      const sig = await program.methods
        .closePolicy()
        .accounts({ owner: publicKey, policy: policyPda })
        .rpc();

      setCloseStatus("정책 종료 완료. Vault 잔액이 지갑으로 반환되었습니다.");
      setCloseTxSig(sig);
      connection.getBalance(publicKey).then((l) => setWalletBalance(l / anchor.web3.LAMPORTS_PER_SOL));
    } catch (err) {
      setCloseStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCloseBusy(false);
    }
  }

  return (
    <main className="flex-1 flex flex-col items-center gap-8 p-8 pt-24 max-w-xl mx-auto w-full">
      <h1 className="text-3xl font-semibold tracking-tight">Allowance</h1>
      <WalletMultiButton className="transition-colors" />

      <div className="w-full flex flex-col gap-3 border border-white/10 bg-white/[0.03] rounded-xl p-6">
        {!pendingParse && (
          <>
            <textarea
              className="w-full border border-white/15 bg-white/5 rounded p-3 min-h-24 placeholder:text-white/40 transition-colors focus:outline-none focus:border-accent"
              placeholder='예: "커피숍 결제로 한달 5만원까지 등록해줘"'
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="bg-accent text-black font-medium rounded py-2 transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={busy || !text.trim()}
              onClick={handleSubmit}
            >
              {busy ? "처리 중..." : "정책 등록/갱신"}
            </button>
          </>
        )}

        {pendingParse && (
          <div className="w-full flex flex-col gap-2 border border-accent/40 bg-accent/5 rounded p-3">
            <p className="text-sm font-medium">
              {pendingParse.action === "initialize" ? "새 정책 생성" : "정책 갱신"} 확인
            </p>
            <p className="text-sm text-white/70">가맹점: {pendingParse.merchant}</p>
            <p className="text-sm text-white/70">한도: {pendingParse.budgetSol} SOL</p>
            <p className="text-sm text-white/70">
              만료: {new Date(pendingParse.validUntil * 1000).toLocaleDateString()}
            </p>
            <div className="flex gap-2 pt-1">
              <button
                className="flex-1 bg-accent text-black font-medium rounded py-2 transition-opacity hover:opacity-90 disabled:opacity-40"
                disabled={busy}
                onClick={handleConfirm}
              >
                {busy ? "처리 중..." : "확인하고 서명"}
              </button>
              <button
                className="flex-1 border border-white/15 rounded py-2 transition-colors hover:border-white/40 disabled:opacity-40"
                disabled={busy}
                onClick={handleCancelConfirm}
              >
                취소
              </button>
            </div>
          </div>
        )}

        {status && (
          <p className="text-sm whitespace-pre-wrap text-white/70">
            {status}
            {txSig && (
              <>
                {" "}
                <a
                  href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline"
                >
                  탐색기에서 보기
                </a>
              </>
            )}
          </p>
        )}
      </div>

      <div className="w-full flex flex-col gap-3 border border-white/10 bg-white/[0.03] rounded-xl p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Vault 예치</h2>
          {publicKey && (
            <span className="text-xl font-semibold text-accent">
              {walletBalance === null ? "조회 중..." : `${walletBalance.toFixed(4)} SOL`}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            step="any"
            min="0"
            className="flex-1 border border-white/15 bg-white/5 rounded p-2 placeholder:text-white/40 transition-colors focus:outline-none focus:border-accent"
            placeholder="예치할 SOL 수량"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
          />
          <button
            className="bg-accent text-black font-medium rounded px-4 transition-opacity hover:opacity-90 disabled:opacity-40"
            disabled={depositBusy || !publicKey || !Number(depositAmount)}
            onClick={handleDeposit}
          >
            {depositBusy ? "처리 중..." : "예치"}
          </button>
        </div>
        {depositStatus && (
          <p className="text-sm whitespace-pre-wrap text-white/70">
            {depositStatus}
            {depositTxSig && (
              <>
                {" "}
                <a
                  href={`https://explorer.solana.com/tx/${depositTxSig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline"
                >
                  탐색기에서 보기
                </a>
              </>
            )}
          </p>
        )}
      </div>

      <div className="w-full flex flex-col gap-3 border border-white/10 bg-white/[0.03] rounded-xl p-6">
        <h2 className="text-lg font-medium">결제 알림 봇 설정</h2>
        <input
          type="password"
          className="w-full border border-white/15 bg-white/5 rounded p-2 placeholder:text-white/40 transition-colors focus:outline-none focus:border-accent"
          placeholder={botConfigured ? "설정됨 (변경하려면 새 토큰 입력)" : "Telegram Bot Token"}
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
        />
        <input
          className="w-full border border-white/15 bg-white/5 rounded p-2 placeholder:text-white/40 transition-colors focus:outline-none focus:border-accent"
          placeholder="Telegram Chat ID"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
        />
        <button
          className="border border-white/15 rounded py-2 transition-colors disabled:opacity-40 hover:border-accent hover:text-accent"
          disabled={!publicKey || !chatId || (!botToken && !botConfigured)}
          onClick={handleSaveNotifyConfig}
        >
          알림 봇 저장
        </button>
        {notifyStatus && <p className="text-sm text-white/70">{notifyStatus}</p>}
      </div>

      <div className="w-full flex flex-col gap-3 border border-red-500/30 bg-red-500/[0.03] rounded-xl p-6">
        <h2 className="text-lg font-medium">긴급 회수</h2>
        <p className="text-sm text-white/60">
          정책을 즉시 종료하고 Vault에 남은 잔액 전체를 지갑으로 돌려받습니다.
        </p>
        <button
          className="border border-red-500/50 text-red-400 rounded py-2 transition-colors hover:bg-red-500/10 disabled:opacity-40"
          disabled={closeBusy || !publicKey}
          onClick={handleClosePolicy}
        >
          {closeBusy ? "처리 중..." : "정책 종료 및 잔액 회수"}
        </button>
        {closeStatus && (
          <p className="text-sm whitespace-pre-wrap text-white/70">
            {closeStatus}
            {closeTxSig && (
              <>
                {" "}
                <a
                  href={`https://explorer.solana.com/tx/${closeTxSig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline"
                >
                  탐색기에서 보기
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </main>
  );
}
