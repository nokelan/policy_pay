use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Policy {
    pub owner: Pubkey,
    pub agent: Pubkey,
    #[max_len(5)]
    pub allowed_recipients: Vec<Pubkey>,
    pub budget_limit: u64,
    pub spent: u64,
    pub period_start: i64,
    pub max_per_tx: u64,
    pub valid_until: i64,
    pub bump: u8,
}
