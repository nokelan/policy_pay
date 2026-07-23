use anchor_lang::prelude::*;

use crate::{constants::*, state::Policy};

#[derive(Accounts)]
pub struct InitializePolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Policy::INIT_SPACE,
        seeds = [POLICY_SEED, owner.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, Policy>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_policy(
    ctx: Context<InitializePolicy>,
    agent: Pubkey,
    allowed_recipient: Pubkey,
    budget_limit: u64,
) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    policy.owner = ctx.accounts.owner.key();
    policy.agent = agent;
    policy.allowed_recipient = allowed_recipient;
    policy.budget_limit = budget_limit;
    policy.spent = 0;
    policy.period_start = Clock::get()?.unix_timestamp;
    policy.bump = ctx.bumps.policy;

    msg!("Policy initialized: budget_limit = {}", budget_limit);
    Ok(())
}
