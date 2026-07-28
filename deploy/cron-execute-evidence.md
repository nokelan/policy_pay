# 자율결제(cron-execute) 증거자료 (2026-07-28)

`app/cron-execute.ts`가 `app/schedules.json`에 등록된 스케줄을 읽어 사람 개입 없이
`policyPay`를 자동 실행하고, 실행 결과를 온체인에 기록한 증거.

## 정책 정보 (devnet)

- owner pubkey: `DQFAwWSowG3bpNGSCMkWCNK8gDm2BVAkKcmSZVJznebP`
- agent pubkey: `8sSjNhHuGKodizvQaf8wEkbnbpZyRDvLUA1zR7GaP14s`
- policyPda: `DtybRg1aag7P4rH1Wdiqk9ki9dQEvhZotBhkbpNeqMBv`
- recipient (커피숍): `3CuNmvrCkhuPJZb9WC7q4qJThwKkeTBFKt9nMQTkqMHb`
- budget_limit: 20,000,000 lamports (0.02 SOL) / max_per_tx: 5,000,000 lamports

## 스케줄 (app/schedules.json)

```json
{
  "owner": "DQFAwWSowG3bpNGSCMkWCNK8gDm2BVAkKcmSZVJznebP",
  "merchant": "커피숍",
  "amountSol": 0.001,
  "intervalSec": 60,
  "lastRunUnix": 0
}
```

## 온체인 트랜잭션

- initialize_policy: https://explorer.solana.com/tx/59AhvenXAg7QJ6fyb3GFJk74WtzYWmAcCG88AnuswZxGBTXCN9vxep8aD8MTnsouTL2pS23hEeARMdtaDPb2ewDX?cluster=devnet
- deposit: https://explorer.solana.com/tx/4tFSi7TrkEUAoRV5y5DoQdRnzT4myCUN653R3dqynZfXbiH1HxvQ1KftRLAVmmX8khR6xnaBRo7yR6ygLzmea1ZG?cluster=devnet
- **policyPay (cron-execute 자동 실행)**: https://explorer.solana.com/tx/56dhjYqfQZ7QdaW7TXsMoqgwuxXxchW4e5N6SrfuTLDHzCfWnXduBdjZpJCcDPStL8KP3qhYG1hJ7QGCowcXDk4h?cluster=devnet

## 실행 로그

```
$ npm run cron-execute

> app@1.0.0 cron-execute
> ts-node cron-execute.ts

[스케줄] owner=DQFAwWSowG3bpNGSCMkWCNK8gDm2BVAkKcmSZVJznebP merchant=커피숍 amount=0.001 SOL 실행 시도
[실행] agent=8sSjNhHuGKodizvQaf8wEkbnbpZyRDvLUA1zR7GaP14s policy=DtybRg1aag7P4rH1Wdiqk9ki9dQEvhZotBhkbpNeqMBv recipient=커피숍 amount=0.001 SOL
[OK] 자율결제 실행 완료. tx=56dhjYqfQZ7QdaW7TXsMoqgwuxXxchW4e5N6SrfuTLDHzCfWnXduBdjZpJCcDPStL8KP3qhYG1hJ7QGCowcXDk4h
```

실행 후 `schedules.json`의 `lastRunUnix`가 `1785203845`로 자동 갱신됨 —
사람이 트리거하지 않고 스케줄 기반으로 자율 실행되었음을 증명.

## 참고: 발견된 버그 (별도 보고 완료)

기존에 funder 지갑(`~/.config/solana/id.json`)을 owner로 재사용해 만들어졌던
구버전 레이아웃의 policy 계정(`5cUmN9X1FBhBhgkKSsbgjQxNQiPfdRXZz89LDkzNYJso`)을
현재 IDL로 `.fetch()`하면 borsh 디코딩이 깨진 Vec 길이 필드를 읽어 heap OOM이
발생하는 문제를 발견했다. 이번 증거자료는 이 문제를 피해 완전히 새로 생성한
owner/agent 키페어로 정책을 다시 초기화해 진행했다.
