use anchor_lang::prelude::*;

#[constant]
pub const POLICY_SEED: &[u8] = b"policy";

#[constant]
pub const PERIOD_SECONDS: i64 = 30 * 24 * 60 * 60;
