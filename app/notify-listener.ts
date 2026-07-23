import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { decryptSecret } from "./secret";

const CONFIG_PATH = path.join(__dirname, "notify-config.json");

interface NotifyEntry {
  botTokenEnc: string;
  chatId: string;
  ownerPubkey: string;
}

function loadConfig(): Record<string, NotifyEntry> {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("[ERROR] Telegram sendMessage failed:", data);
  } else {
    console.log(`[OK]    Telegram notification sent to chat ${chatId}`);
  }
}

async function main() {
  if (!process.env.HELIUS_API_KEY) {
    throw new Error("HELIUS_API_KEY is not set in app/.env");
  }

  const idlPath = path.join(__dirname, "..", "target", "idl", "policy_pay.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const programId = new PublicKey(idl.address);

  const connection = new Connection(
    `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    {
      commitment: "confirmed",
      wsEndpoint: `wss://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    }
  );

  const coder = new anchor.BorshCoder(idl);
  const eventParser = new anchor.EventParser(programId, coder);

  console.log(`[DEBUG] listening for PaymentExecuted events on program ${programId.toBase58()}`);

  connection.onLogs(
    programId,
    (logInfo) => {
      if (logInfo.err) return;
      console.log(`[DEBUG] logs received, signature=${logInfo.signature}`);

      for (const event of eventParser.parseLogs(logInfo.logs)) {
        console.log(`[DEBUG] parsed event: ${event.name}`, event.data);
        if (event.name !== "PaymentExecuted") continue;

        const policy = (event.data.policy as PublicKey).toBase58();
        const recipient = (event.data.recipient as PublicKey).toBase58();
        const amount = (event.data.amount as anchor.BN).toNumber();
        const timestamp = (event.data.timestamp as anchor.BN).toNumber();

        const config = loadConfig();
        const entry = config[policy];
        if (!entry) {
          console.log(`[DEBUG] no notify config for policy ${policy}, skipping`);
          continue;
        }

        const sol = amount / anchor.web3.LAMPORTS_PER_SOL;
        const text =
          `[Allowance] 결제 실행\n` +
          `금액: ${sol} SOL\n` +
          `수신처: ${recipient}\n` +
          `시각: ${new Date(timestamp * 1000).toLocaleString("ko-KR")}\n` +
          `tx: ${logInfo.signature}`;

        sendTelegramMessage(decryptSecret(entry.botTokenEnc), entry.chatId, text).catch((err) =>
          console.error("[ERROR] sendTelegramMessage threw:", err)
        );
      }
    },
    "confirmed"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
