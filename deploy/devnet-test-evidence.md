# Devnet Smoke Test Evidence (2026-07-28)

`app/devnet-test.ts` 실행 결과. Anchor 프로그램의 12개 시나리오(initialize_policy →
deposit → policy_pay happy path → guard rail 7종 → multi-merchant → expired
policy)가 실제 Solana devnet에서 전부 통과했다.

owner pubkey: `Ex2WZPUvA5bFvLyQmNLkUAEVk9GUWyUBKXwVsUh2VWYh`

## 온체인 트랜잭션

- initialize_policy: https://explorer.solana.com/tx/5iaJoGQTHTNf6hj4xMqAY6EqA4ecsBc81EgNromp68pL1q9TtvLq1LhE5avbBT9UED7cMaFnm7PGMsMMUQW75dMG?cluster=devnet
- deposit: https://explorer.solana.com/tx/4EDLUPuZ1FTq3e8fDxuqBE8FQdFL9hgJ2edwVBy54DZ76pdNBBx8gh1PozvbMKAP78WCQnptBB89q6g3C74SsfGB?cluster=devnet
- policy_pay (happy path): https://explorer.solana.com/tx/61pySdqbHZaVmMm4xQAxiGvpy2LoJp5w9mtR5dQvkhQ1AmC8db1PiXYJtQZvCRFfyYMZbzXmQy2eBEmhiEE1r26z?cluster=devnet

## 전체 콘솔 로그

```
Now using node v24.18.0 (npm v11.16.0)
[OK]   owner and recipients funded on devnet
       owner pubkey = Ex2WZPUvA5bFvLyQmNLkUAEVk9GUWyUBKXwVsUh2VWYh
== 1. initialize_policy (devnet) ==
[OK]   policy initialized, budget_limit = 1000000
       tx = https://explorer.solana.com/tx/5iaJoGQTHTNf6hj4xMqAY6EqA4ecsBc81EgNromp68pL1q9TtvLq1LhE5avbBT9UED7cMaFnm7PGMsMMUQW75dMG?cluster=devnet
== 2. deposit (devnet) ==
[OK]   policy vault balance = 3318800 lamports
       tx = https://explorer.solana.com/tx/4EDLUPuZ1FTq3e8fDxuqBE8FQdFL9hgJ2edwVBy54DZ76pdNBBx8gh1PozvbMKAP78WCQnptBB89q6g3C74SsfGB?cluster=devnet
== 3. policy_pay happy path (devnet) ==
[OK]   recipient received 100000 lamports on devnet
       tx = https://explorer.solana.com/tx/61pySdqbHZaVmMm4xQAxiGvpy2LoJp5w9mtR5dQvkhQ1AmC8db1PiXYJtQZvCRFfyYMZbzXmQy2eBEmhiEE1r26z?cluster=devnet
== 4. guard rail: wrong agent (devnet) ==
[OK]   policy_pay with wrong agent: got expected error "NotAgent"
== 5. guard rail: per-tx limit exceeded (devnet) ==
[OK]   policy_pay over max_per_tx: got expected error "PerTxLimitExceeded"
== 6. multi-merchant: add recipients up to max (devnet) ==
[OK]   5 recipients registered on policy
== 7. multi-merchant: pay to newly added recipient (devnet) ==
[OK]   recipient2 received payment on devnet
== 8. guard rail: duplicate recipient (devnet) ==
[OK]   add_recipient duplicate: got expected error "RecipientAlreadyRegistered"
== 9. guard rail: recipient list full (devnet) ==
[OK]   add_recipient over max: got expected error "RecipientListFull"
== 10. multi-merchant: remove recipient then pay fails (devnet) ==
[OK]   policy_pay to removed recipient: got expected error "RecipientNotAllowed"
== 11. guard rail: remove nonexistent recipient (devnet) ==
[OK]   remove_recipient not registered: got expected error "RecipientNotFound"
== 12. guard rail: expired policy (devnet) ==
[OK]   policy_pay after valid_until: got expected error "PolicyExpired"

DEVNET SMOKE TEST PASSED
```
