# Allowance (policy_pay)

Solana devnet 상의 자율 결제 위임 프로그램. 지갑 소유자가 자연어("커피숍 결제로 한달 5만원까지 등록해줘")로 결제 정책을 설정하면, 위임된 에이전트 키가 그 한도 안에서만 지정 가맹점에 자율 정산할 수 있다.

Google X Solana AI Agentic Hackathon 출품작 (Track B: Autonomous On-chain Settlement).

## 구성

- `programs/policy_pay` — Anchor 프로그램. 정책(owner, agent, allowed_recipient, budget_limit)을 온체인 PDA로 관리.
  - `initialize_policy` / `update_policy` — owner가 정책 생성/수정
  - `deposit` — vault에 예치
  - `policy_pay` — agent 키가 정책 한도 내에서만 allowed_recipient로 결제 실행. budget_limit은 30일마다 자동 리셋되는 롤링 윈도우 한도이며, 정확히 30일 경계에서 에이전트가 타이밍을 맞추면 최대 2배까지 결제될 수 있다(윈도우형 예산의 고유 한계, 의도적 트레이드오프).
  - `close_policy` — owner 전용 비상 회수(에이전트 키 분실/탈취 대비)
- `app/` — CLI 스크립트. 자연어 정책 파싱(Gemini) + 로컬 키페어로 트랜잭션 서명.
- `ui/` — Next.js 웹 UI. 브라우저 지갑(Phantom 등) 연결 후 자연어로 정책을 등록/갱신. 자연어 파싱은 서버 API route(`/api/parse-policy`)에서 Gemini로 처리하고, 실제 서명은 클라이언트의 지갑 어댑터가 담당한다.

## 프로그램 ID

Devnet: `5jG2u5KYT115AiRKQFSfU9P5Yv29DLtyTWC5vPZYmTEW`

## Anchor 프로그램 build/deploy

```bash
anchor build

# 최초 1회: devnet 배포용 지갑 준비
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json   # 이미 있으면 생략
solana airdrop 2                                 # devnet SOL 확보 (배포 수수료용)

anchor deploy --provider.cluster devnet
```

프로그램 ID는 `target/deploy/policy_pay-keypair.json`에서 고정되며, 재배포 시에도
`programs/policy_pay/src/lib.rs`의 `declare_id!(...)`와 `Anchor.toml`의
`[programs.devnet]` 값이 서로 일치해야 한다. IDL은 `target/idl/policy_pay.json`에
생성되고 `app/`, `ui/`의 스크립트가 이 경로를 그대로 참조한다.

## env 키 발급처

| 키 | 사용처 | 발급처 |
|---|---|---|
| `GEMINI_API_KEY` | `app/.env`, `ui/.env.local` — 자연어 정책 파싱(Gemini) | [Google AI Studio](https://aistudio.google.com/apikey) |
| `HELIUS_API_KEY` | `app/.env` — devnet RPC/WS 엔드포인트 (`devnet-test.ts`, `notify-listener.ts`) | [Helius 대시보드](https://dashboard.helius.dev) |
| `NOTIFY_CONFIG_KEY` | `app/.env`, `ui/.env.local` — `notify-config.json`에 저장된 텔레그램 봇 토큰 등을 AES-256-GCM으로 암복호화하는 로컬 시크릿(외부 발급 아님) | 직접 생성: `openssl rand -hex 32` (32바이트 hex, 64자) |

## 스크립트 실행 순서 (app/)

```bash
cd app
npm install
```

1. `npx ts-node devnet-test.ts` — devnet 연결 확인 + initialize_policy/deposit/policy_pay 최소 플로우 점검
2. `npm run nl-policy` (`nl-policy.ts`) — 자연어로 정책 생성/갱신, owner별 `agent-keypair-{policyPda}.json` 자동 생성
3. `npm run agent-execute` (`agent-execute.ts`) — agent 키로 1회성 결제 실행(`merchants.json` 기준 수신자 조회)
4. `npm run cron-execute` (`cron-execute.ts`) — `schedules.json`에 등록된 스케줄을 읽어 `agent-execute`의 `executePayment`를 자동 반복 실행, 실행 후 `lastRunUnix` 갱신
5. `npm run notify-listener` (`notify-listener.ts`, 선택) — 온체인 이벤트 구독 후 텔레그램 알림 발송(`notify-config.json` 필요)

## merchants.json / schedules.json 세팅법

`app/merchants.json` — 가맹점명 → 수신 지갑 주소:

```json
{
  "커피숍": "3CuNmvrCkhuPJZb9WC7q4qJThwKkeTBFKt9nMQTkqMHb"
}
```

`app/schedules.json` — 자율결제 스케줄(배열 아님, 단일 객체 1건 기준):

```json
{
  "owner": "<정책 owner pubkey>",
  "merchant": "커피숍",
  "amountSol": 0.001,
  "intervalSec": 60,
  "lastRunUnix": 0
}
```

`owner`는 `nl-policy.ts`로 생성한 policy 계정의 owner와 일치해야 하고, `merchant`는
`merchants.json`에 등록된 키와 일치해야 한다. `lastRunUnix`는 최초 등록 시 `0`으로
두면 즉시 실행 대상이 되고, 이후 `cron-execute.ts`가 실행 시각으로 자동 갱신한다.

## 로컬 실행 (UI)

```bash
cd ui
npm install
# .env.local에 GEMINI_API_KEY, NOTIFY_CONFIG_KEY 설정
npm run dev
```

## 로컬 실행 (CLI)

```bash
cd app
npm install
# .env에 GEMINI_API_KEY, HELIUS_API_KEY, NOTIFY_CONFIG_KEY 설정
npx ts-node nl-policy.ts
```

CLI 스크립트 전체 실행 순서는 위 "스크립트 실행 순서" 절 참고.
