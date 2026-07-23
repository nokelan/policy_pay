# VPS 배포 체크리스트 (allowance.autotaxsystem.co.kr)

전제: AWS Lightsail VPS `15.164.189.87`, SSH 키 `autotax_key.pem` (nokel PC 보유), 기존 nginx가 kmediwell.autotaxsystem.co.kr 서비스 중.

## 0. 확인 필요 (미확인 상태로 진행하지 말 것)
- [ ] **target/idl/policy_pay.json이 .gitignore의 `target` 규칙에 걸려 GitHub repo에 없음** — VPS에서 `git clone` 후 `npm run notify-listener`, `/api/notify-config` 라우트가 IDL_PATH를 못 찾아 즉시 에러남. 배포 전 IDL만 별도로 커밋(예: `idl/policy_pay.json`)하거나 VPS에 scp로 직접 복사 필요. **결정 후 진행.**
- [ ] VPS의 Node.js 버전 확인 (`node -v`) — 로컬 개발은 v24.18.0 사용 중. 버전 다르면 nvm으로 동일 버전 설치 권장.
- [ ] 포트 3100이 비어있는지 확인 (`sudo ss -tlnp | grep 3100`).

## 1. 코드 배포
```
sudo mkdir -p /var/www/policy-pay && sudo chown ubuntu:ubuntu /var/www/policy-pay
git clone https://github.com/nokelan/policy_pay /var/www/policy-pay
cd /var/www/policy-pay/ui && npm install && npm run build
cd /var/www/policy-pay/app && npm install
```

## 2. 환경변수
- `deploy/env-production.ui.template` → `/var/www/policy-pay/ui/.env.production` (GEMINI_API_KEY, NOTIFY_CONFIG_KEY 채우기)
- `deploy/env-production.app.template` → `/var/www/policy-pay/app/.env.production` (GEMINI_API_KEY, HELIUS_API_KEY, NOTIFY_CONFIG_KEY 채우기)
- **NOTIFY_CONFIG_KEY 값은 두 파일 동일해야 함** (기존 로컬 app/.env, ui/.env.local과도 동일한 값 사용 — 안 그러면 기존 notify-config.json 복호화 실패)
- `chmod 600` 두 파일 모두

## 3. notify-config.json 이관
로컬 `app/notify-config.json` (암호화된 상태)을 그대로 scp로 VPS `/var/www/policy-pay/app/notify-config.json`에 복사.

## 4. systemd 서비스 등록
```
sudo cp deploy/policy-pay-ui.service deploy/policy-pay-notify-listener.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now policy-pay-ui policy-pay-notify-listener
sudo systemctl status policy-pay-ui policy-pay-notify-listener
```

## 5. nginx + TLS
```
sudo cp deploy/nginx-allowance.conf /etc/nginx/sites-available/allowance.autotaxsystem.co.kr
sudo ln -s /etc/nginx/sites-available/allowance.autotaxsystem.co.kr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d allowance.autotaxsystem.co.kr
```
(도메인 DNS에 A레코드 allowance.autotaxsystem.co.kr → 15.164.189.87 먼저 추가되어 있어야 함)

## 6. 확인
- https://allowance.autotaxsystem.co.kr 접속 확인
- 지갑 연결 → 정책 생성/결제 실행 → 텔레그램 알림 수신까지 end-to-end 테스트
