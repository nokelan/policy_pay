import * as fs from "fs";
import * as path from "path";
import { executePayment } from "./agent-execute";

const SCHEDULES_PATH = path.join(__dirname, "schedules.json");

interface Schedule {
  owner: string;
  merchant: string;
  amountSol: number;
  intervalSec: number;
  lastRunUnix: number;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(SCHEDULES_PATH, "utf-8"));
  const schedules: Schedule[] = data.schedules ?? [];
  const nowSec = Math.floor(Date.now() / 1000);

  for (const schedule of schedules) {
    if (nowSec - schedule.lastRunUnix < schedule.intervalSec) {
      continue;
    }
    console.log(`[스케줄] owner=${schedule.owner} merchant=${schedule.merchant} amount=${schedule.amountSol} SOL 실행 시도`);
    try {
      await executePayment(schedule.owner, schedule.merchant, String(schedule.amountSol));
      schedule.lastRunUnix = nowSec;
    } catch (err) {
      console.error(
        `[오류] 스케줄 결제 실패 (owner=${schedule.owner}, merchant=${schedule.merchant}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  fs.writeFileSync(SCHEDULES_PATH, JSON.stringify(data, null, 2) + "\n");
}

main().catch((err) => {
  console.error(`[오류] cron-execute 실행 실패: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
