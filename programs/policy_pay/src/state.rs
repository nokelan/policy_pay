use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Policy {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub allowed_recipient: Pubkey,
    pub budget_limit: u64,
    pub spent: u64,
    pub period_start: i64,
    pub bump: u8,
}
