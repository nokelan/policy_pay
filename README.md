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

## 로컬 실행 (UI)

```bash
cd ui
npm install
# .env.local에 GEMINI_API_KEY 설정
npm run dev
```

## 로컬 실행 (CLI)

```bash
cd app
npm install
# .env에 GEMINI_API_KEY 설정
npx ts-node nl-policy.ts
```
