import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

const IDL_PATH = path.join(process.cwd(), "..", "target", "idl", "policy_pay.json");

export async function GET() {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  return NextResponse.json(idl);
}
