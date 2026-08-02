# Allowance (policy_pay)

Solana devnet 상의 자율 결제 위임 프로그램. 지갑 소유자가 자연어("커피숍 결제로 한달 5만원까지 등록해줘")로 결제 정책을 설정하면, 위임된 에이전트 키가 그 한도 안에서만 지정 가맹점에 자율 정산할 수 있다.

Google X Solana AI Agentic Hackathon(Track B: Autonomous On-chain Settlement) 출품 목표로 개발 시작. 2026-08-02, 웹서치로 Solana가 이미 유사 개념의 네이티브 감사 프로그램("Subscriptions & Allowances" — 위임자에게 예산상한+만료기간을 걸고 자율 지출시키는 기능, AI 에이전트 유즈케이스로 공식 소개됨)을 메인넷에 출시한 사실을 확인해 실제 출품은 보류하고, devnet PoC/공개 레퍼런스 코드로 공개.

## 프로젝트 히스토리

- **2026-07-22 — 온체인 프로그램 구현**: Anchor로 Policy PDA 프로그램 최초 구현. owner당 정책 계정 1개(결정론적 PDA), 4개 instruction(initialize_policy/deposit/policy_pay/update_policy)으로 권한 분리를 온체인 제약으로 강제. 로컬 validator 통합테스트(정상 결제 + 가드레일 위반 3케이스) 통과 후 devnet 배포.
- **2026-07-23 — 자연어 정책 레이어 + 보안 강화**: Gemini API로 자연어("커피숍 결제로 한달 5만원까지") → 정책 파싱 구현. 원화 단위 미표기 시 "5만원"을 5만 SOL로 오인하는 버그를 테스트 중 발견해 CoinGecko 실시간 환율 연동으로 수정. 텔레그램 결제알림 도입하며 봇 토큰을 AES-256-GCM으로 암호화 저장, 설정 API에 재전송(replay) 방지·요청빈도 제한 추가.
- **2026-07-24~28 — VPS 배포 및 실증**: 기존 Lightsail VPS를 서브도메인(allowance.autotaxsystem.co.kr)으로 재사용 배포. devnet-test.ts 12개 시나리오 전부 통과 증거화, schedules.json 기반 cron 자율결제 실제 온체인 트랜잭션 발생 확인. close_policy(소유자 긴급 회수) 기능 추가.
- **2026-07-31 — 버그 수정 + 코드 전체 리뷰**: 실사용 중 발견된 버그 4건 수정(Next.js TS 타입 오류, 구버전 스키마 계정 조회 시 Node OOM, 에이전트 키 devnet SOL 0으로 인한 결제 실패, notify-config chatId 오입력으로 알림 미발송). 이후 34개 에이전트 병렬 코드리뷰(24건 확인)에서 주요 보안 이슈 발견: notify-config API GET/POST가 서명 메시지를 공유해 서명 재사용으로 chatId 탈취 가능(High), 서버가 에이전트 개인키를 평문 저장하며 `maxPerTx == budgetLimit`+365일 유효기간이라 키 1건 유출 시 30일 주기로 예산 전액이 반복 탈취 가능(High). 이 외 재전송 방지 미흡, cron 중복실행 방지 락 부재, 환경변수/키페어 파일 권한 0644 등 중/저위험 이슈 다수. 예산 윈도우 롤오버 미검증으로 인한 결제 영구 실패 가능성, README-실제코드 스키마 불일치 등 정확성 이슈도 확인.
- **2026-08-02 — 출품 보류 결정**: 해커톤 마감(2026-08-03 23:59 KST) 하루 전, 웹서치로 경쟁 구도를 점검한 결과 (1) Solana가 이미 동일 개념(위임자 예산상한+만료기간, AI 에이전트 자율결제 유즈케이스)의 감사받은 네이티브 프로그램을 메인넷에 출시했고, (2) 해커톤 자체 홍보가 x402(Coinbase 표준) 기반 시나리오를 주로 내세우는데 본 프로젝트는 x402 미사용, (3) 위 보안 리뷰에서 나온 High 이슈 다수가 제출 전 해소되지 않은 점을 종합해 실제 제출은 하지 않기로 결정. Repo는 공개 유지, budget-limit PDA 기반 자율 결제 위임 패턴의 참고 구현으로 남김.

## 알려진 이슈 (미해결, 재사용 시 주의)

- 에이전트 개인키를 서버가 평문 생성/저장 — 키 유출 시 정책 예산 전액이 반복 탈취될 수 있음. 프로덕션 사용 전 KMS/HSM 등으로 교체 필요.
- notify-config API의 GET/POST가 서명 메시지를 공유해 서명 재사용 위험 있음.
- 예산 한도가 30일 롤링 윈도우로 자동 리셋되는데, 오프체인 cron/agent 경로에서 윈도우 롤오버(`period_start`)를 검증하지 않아 특정 조건에서 결제가 영구 실패할 수 있음.
- 위 항목 모두 devnet 전용 PoC 상태에서 발견된 것으로 미수정 — mainnet/실자금 연동 전 반드시 재검토 필요.

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

`app/schedules.json` — 자율결제 스케줄 목록(`schedules` 배열로 감싸야 함):

```json
{
  "schedules": [
    {
      "owner": "<정책 owner pubkey>",
      "merchant": "커피숍",
      "amountSol": 0.001,
      "intervalSec": 60,
      "lastRunUnix": 0
    }
  ]
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

---
수정: Claude (요청자: 화비스) | 날짜: 2026-08-02 | 해커톤 출품 보류 결정 반영, 프로젝트 히스토리/알려진 이슈 섹션 추가
