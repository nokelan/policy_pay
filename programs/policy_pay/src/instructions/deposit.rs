use anchor_lang::prelude::*;

use crate::{constants::*, state::Policy};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner,
    )]
    pub policy: Account<'info, Policy>,
    pub system_program: Program<'info, System>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.owner.to_account_info(),
        to: ctx.accounts.policy.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.system_program.key(), cpi_accounts);
    anchor_lang::system_program::transfer(cpi_ctx, amount)?;

    msg!("Deposited {} lamports into policy vault", amount);
    Ok(())
}
