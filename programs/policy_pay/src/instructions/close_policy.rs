use anchor_lang::prelude::*;

use crate::{constants::*, state::Policy};

#[derive(Accounts)]
pub struct ClosePolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner,
        close = owner,
    )]
    pub policy: Account<'info, Policy>,
}

// Owner-only escape hatch: without this, a lost or compromised agent key
// would leave vault funds permanently locked, since only the agent can
// trigger payments and the PDA seed only ever allows one policy per owner.
pub fn handle_close_policy(_ctx: Context<ClosePolicy>) -> Result<()> {
    msg!("Policy closed, vault balance returned to owner");
    Ok(())
}
