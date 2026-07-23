use anchor_lang::prelude::*;

#[event]
pub struct PaymentExecuted {
    pub policy: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
