import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
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
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  const owner = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  const agent = Keypair.generate();
  const wrongAgent = Keypair.generate();
  const recipient = Keypair.generate();
  const wrongRecipient = Keypair.generate();

  for (const kp of [agent, wrongAgent, recipient]) {
    const sig = await connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

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

  const budgetLimit = new anchor.BN(1_000_000); // lamports

  console.log("== 1. initialize_policy ==");
  await program.methods
    .initializePolicy(agent.publicKey, recipient.publicKey, budgetLimit)
    .accounts({
      owner: owner.publicKey,
      policy: policyPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  let policy = await (program.account as any).policy.fetch(policyPda);
  console.log("[OK]   policy initialized, budget_limit =", policy.budgetLimit.toString());

  console.log("== 2. deposit ==");
  await program.methods
    .deposit(new anchor.BN(2_000_000))
    .accounts({
      owner: owner.publicKey,
      policy: policyPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  const vaultBalance = await connection.getBalance(policyPda);
  console.log("[OK]   policy vault balance =", vaultBalance, "lamports");

  console.log("== 3. policy_pay (happy path) ==");
  const payAmount = new anchor.BN(500_000);
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
  if (recipientAfter - recipientBefore !== 500_000) {
    throw new Error(
      `[FAIL] policy_pay: recipient balance delta = ${recipientAfter - recipientBefore}, expected 500000`
    );
  }
  console.log("[OK]   recipient received 500000 lamports");

  console.log("== 4. guard rail checks ==");
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

  await expectError(
    "policy_pay with disallowed recipient",
    () =>
      program.methods
        .policyPay(new anchor.BN(1))
        .accounts({
          agent: agent.publicKey,
          policy: policyPda,
          recipient: wrongRecipient.publicKey,
        })
        .signers([agent])
        .rpc(),
    "RecipientNotAllowed"
  );

  await expectError(
    "policy_pay exceeding budget",
    () =>
      program.methods
        .policyPay(new anchor.BN(10_000_000))
        .accounts({
          agent: agent.publicKey,
          policy: policyPda,
          recipient: recipient.publicKey,
        })
        .signers([agent])
        .rpc(),
    "BudgetExceeded"
  );

  console.log("== 5. update_policy ==");
  const newBudget = new anchor.BN(9_999_999);
  await program.methods
    .updatePolicy(agent.publicKey, newBudget, wrongRecipient.publicKey)
    .accounts({
      owner: owner.publicKey,
      policy: policyPda,
    })
    .rpc();
  policy = await (program.account as any).policy.fetch(policyPda);
  if (policy.budgetLimit.toString() !== newBudget.toString()) {
    throw new Error("[FAIL] update_policy: budget_limit not updated");
  }
  if (!policy.allowedRecipient.equals(wrongRecipient.publicKey)) {
    throw new Error("[FAIL] update_policy: allowed_recipient not updated");
  }
  console.log("[OK]   policy updated, new budget_limit =", policy.budgetLimit.toString());

  console.log("\nALL CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
