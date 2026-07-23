use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode, state::Policy};

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, owner.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, Policy>,
}

pub fn handle_update_policy(
    ctx: Context<UpdatePolicy>,
    new_agent: Pubkey,
    new_budget_limit: u64,
    new_max_per_tx: u64,
    new_valid_until: i64,
) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    require_keys_eq!(policy.owner, ctx.accounts.owner.key(), ErrorCode::Unauthorized);

    // Allows rotating a lost/compromised agent key without needing to close
    // and re-initialize the policy (the PDA is fixed 1:1 to the owner).
    // Allowed recipients are managed separately via add_recipient/remove_recipient.
    policy.agent = new_agent;
    policy.budget_limit = new_budget_limit;
    policy.max_per_tx = new_max_per_tx;
    policy.valid_until = new_valid_until;

    msg!("Policy updated: budget_limit = {}", new_budget_limit);
    Ok(())
}
