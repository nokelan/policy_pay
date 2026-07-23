import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function expectError(label: string, fn: () => Promise<unknown>, expected: string) {
  try {
    await fn();
    throw new Error(`[FAIL] ${label}: expected error "${expected}" but call succeeded`);
  } catch (err: any) {
    const code = err?.error?.errorCode?.code;
    const msg = err?.error?.errorMessage || err?.message || String(err);
    if (code === expected || msg.includes(expected)) {
      console.log(`[OK]   ${label}: got expected error "${expected}"`);
    } else {
      throw new Error(`[FAIL] ${label}: expected "${expected}", got: ${msg}`);
    }
  }
}

async function main() {
  if (!process.env.HELIUS_API_KEY) {
    throw new Error("HELIUS_API_KEY is not set in app/.env");
  }
  const connection = new Connection(
    `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    "confirmed"
  );

  const funder = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  // Use a fresh throwaway owner per run: the policy PDA is derived from the
  // owner's pubkey, so reusing the main wallet would collide with whatever
  // policy account is already initialized on devnet for it.
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const wrongAgent = Keypair.generate();
  const recipient = Keypair.generate();
  const recipient2 = Keypair.generate();
  const recipient3 = Keypair.generate();
  const recipient4 = Keypair.generate();
  const recipient5 = Keypair.generate();
  const recipient6 = Keypair.generate();

  // Fund owner (needs to pay tx fees + policy account rent) and recipients
  // (rent-exempt minimum) directly from the main wallet instead of airdrop,
  // to avoid devnet faucet rate limits.
  const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: owner.publicKey,
      lamports: rentExempt + 5_000_000,
    }),
    ...[recipient, recipient2, recipient3, recipient4, recipient5].map((r) =>
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: r.publicKey,
        lamports: rentExempt + 10_000,
      })
    )
  );
  await anchor.web3.sendAndConfirmTransaction(connection, fundTx, [funder]);
  console.log("[OK]   owner and recipients funded on devnet");

  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idlPath = path.join(__dirname, "..", "target", "idl", "policy_pay.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new anchor.Program(idl, provider);

  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), owner.publicKey.toBuffer()],
    program.programId
  );

  const budgetLimit = new anchor.BN(1_000_000);
  const maxPerTx = budgetLimit;
  const validUntil = new anchor.BN(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);

  console.log("== 1. initialize_policy (devnet) ==");
  await program.methods
    .initializePolicy(agent.publicKey, [recipient.publicKey], budgetLimit, maxPerTx, validUntil)
    .accounts({
      owner: owner.publicKey,
      policy: policyPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  let policy = await (program.account as any).policy.fetch(policyPda);
  console.log("[OK]   policy initialized, budget_limit =", policy.budgetLimit.toString());

  console.log("== 2. deposit (devnet) ==");
  await program.methods
    .deposit(new anchor.BN(500_000))
    .accounts({
      owner: owner.publicKey,
      policy: policyPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  const vaultBalance = await connection.getBalance(policyPda);
  console.log("[OK]   policy vault balance =", vaultBalance, "lamports");

  console.log("== 3. policy_pay happy path (devnet) ==");
  const payAmount = new anchor.BN(100_000);
  const recipientBefore = await connection.getBalance(recipient.publicKey);
  await program.methods
    .policyPay(payAmount)
    .accounts({
      agent: agent.publicKey,
      policy: policyPda,
      recipient: recipient.publicKey,
    })
    .signers([agent])
    .rpc();
  const recipientAfter = await connection.getBalance(recipient.publicKey);
  if (recipientAfter - recipientBefore !== 100_000) {
    throw new Error(
      `[FAIL] policy_pay: recipient balance delta = ${recipientAfter - recipientBefore}, expected 100000`
    );
  }
  console.log("[OK]   recipient received 100000 lamports on devnet");

  console.log("== 4. guard rail: wrong agent (devnet) ==");
  await expectError(
    "policy_pay with wrong agent",
    () =>
      program.methods
        .policyPay(new anchor.BN(1))
        .accounts({
          agent: wrongAgent.publicKey,
          policy: policyPda,
          recipient: recipient.publicKey,
        })
        .signers([wrongAgent])
        .rpc(),
    "NotAgent"
  );

  console.log("== 5. guard rail: per-tx limit exceeded (devnet) ==");
  await expectError(
    "policy_pay over max_per_tx",
    () =>
      program.methods
        .policyPay(maxPerTx.add(new anchor.BN(1)))
        .accounts({
          agent: agent.publicKey,
          policy: policyPda,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc(),
    "PerTxLimitExceeded"
  );

  console.log("== 6. multi-merchant: add recipients up to max (devnet) ==");
  for (const r of [recipient2, recipient3, recipient4, recipient5]) {
    await program.methods
      .addRecipient(r.publicKey)
      .accounts({ owner: owner.publicKey, policy: policyPda })
      .rpc();
  }
  policy = await (program.account as any).policy.fetch(policyPda);
  if (policy.allowedRecipients.length !== 5) {
    throw new Error(
      `[FAIL] expected 5 allowed recipients, got ${policy.allowedRecipients.length}`
    );
  }
  console.log("[OK]   5 recipients registered on policy");

  console.log("== 7. multi-merchant: pay to newly added recipient (devnet) ==");
  const recipient2Before = await connection.getBalance(recipient2.publicKey);
  await program.methods
    .policyPay(new anchor.BN(10))
    .accounts({
      agent: agent.publicKey,
      policy: policyPda,
      recipient: recipient2.publicKey,
    })
    .signers([agent])
    .rpc();
  const recipient2After = await connection.getBalance(recipient2.publicKey);
  if (recipient2After - recipient2Before !== 10) {
    throw new Error(
      `[FAIL] policy_pay to recipient2: balance delta = ${recipient2After - recipient2Before}, expected 10`
    );
  }
  console.log("[OK]   recipient2 received payment on devnet");

  console.log("== 8. guard rail: duplicate recipient (devnet) ==");
  await expectError(
    "add_recipient duplicate",
    () =>
      program.methods
        .addRecipient(recipient2.publicKey)
        .accounts({ owner: owner.publicKey, policy: policyPda })
        .rpc(),
    "RecipientAlreadyRegistered"
  );

  console.log("== 9. guard rail: recipient list full (devnet) ==");
  await expectError(
    "add_recipient over max",
    () =>
      program.methods
        .addRecipient(recipient6.publicKey)
        .accounts({ owner: owner.publicKey, policy: policyPda })
        .rpc(),
    "RecipientListFull"
  );

  console.log("== 10. multi-merchant: remove recipient then pay fails (devnet) ==");
  await program.methods
    .removeRecipient(recipient2.publicKey)
    .accounts({ owner: owner.publicKey, policy: policyPda })
    .rpc();
  await expectError(
    "policy_pay to removed recipient",
    () =>
      program.methods
        .policyPay(new anchor.BN(1))
        .accounts({
          agent: agent.publicKey,
          policy: policyPda,
          recipient: recipient2.publicKey,
        })
        .signers([agent])
        .rpc(),
    "RecipientNotAllowed"
  );

  console.log("== 11. guard rail: remove nonexistent recipient (devnet) ==");
  await expectError(
    "remove_recipient not registered",
    () =>
      program.methods
        .removeRecipient(recipient2.publicKey)
        .accounts({ owner: owner.publicKey, policy: policyPda })
        .rpc(),
    "RecipientNotFound"
  );

  console.log("== 12. guard rail: expired policy (devnet) ==");
  await program.methods
    .updatePolicy(
      agent.publicKey,
      budgetLimit,
      maxPerTx,
      new anchor.BN(Math.floor(Date.now() / 1000) - 1000)
    )
    .accounts({
      owner: owner.publicKey,
      policy: policyPda,
    })
    .rpc();
  await expectError(
    "policy_pay after valid_until",
    () =>
      program.methods
        .policyPay(new anchor.BN(1))
        .accounts({
          agent: agent.publicKey,
          policy: policyPda,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc(),
    "PolicyExpired"
  );

  console.log("\nDEVNET SMOKE TEST PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
