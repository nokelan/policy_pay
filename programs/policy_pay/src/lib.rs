pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("5jG2u5KYT115AiRKQFSfU9P5Yv29DLtyTWC5vPZYmTEW");

#[program]
pub mod policy_pay {
    use super::*;

    pub fn initialize_policy(
        ctx: Context<InitializePolicy>,
        agent: Pubkey,
        allowed_recipient: Pubkey,
        budget_limit: u64,
    ) -> Result<()> {
        crate::instructions::initialize_policy::handle_initialize_policy(
            ctx,
            agent,
            allowed_recipient,
            budget_limit,
        )
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        new_agent: Pubkey,
        new_budget_limit: u64,
        new_allowed_recipient: Pubkey,
    ) -> Result<()> {
        crate::instructions::update_policy::handle_update_policy(
            ctx,
            new_agent,
            new_budget_limit,
            new_allowed_recipient,
        )
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        crate::instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn policy_pay(ctx: Context<PolicyPay>, amount: u64) -> Result<()> {
        crate::instructions::policy_pay::handle_policy_pay(ctx, amount)
    }

    // Owner-only escape hatch so vault funds are never permanently locked by
    // a lost/compromised agent key (see close_policy.rs).
    pub fn close_policy(ctx: Context<ClosePolicy>) -> Result<()> {
        crate::instructions::close_policy::handle_close_policy(ctx)
    }
}
