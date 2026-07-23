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
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const funder = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  // Use a fresh throwaway owner per run: the policy PDA is derived from the
  // owner's pubkey, so reusing the main wallet would collide with whatever
  // policy account is already initialized on devnet for it.
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const wrongAgent = Keypair.generate();
  const recipient = Keypair.generate();

  // Fund owner (needs to pay tx fees + policy account rent) and recipient
  // (rent-exempt minimum) directly from the main wallet instead of airdrop,
  // to avoid devnet faucet rate limits.
  const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: owner.publicKey,
      lamports: rentExempt + 5_000_000,
    }),
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: recipient.publicKey,
      lamports: rentExempt + 10_000,
    })
  );
  await anchor.web3.sendAndConfirmTransaction(connection, fundTx, [funder]);
  console.log("[OK]   owner and recipient funded on devnet");

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

  console.log("== 1. initialize_policy (devnet) ==");
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

  console.log("\nDEVNET SMOKE TEST PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
