use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode, state::Policy};

#[derive(Accounts)]
pub struct RemoveRecipient<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner,
    )]
    pub policy: Account<'info, Policy>,
}

pub fn handle_remove_recipient(ctx: Context<RemoveRecipient>, recipient: Pubkey) -> Result<()> {
    let policy = &mut ctx.accounts.policy;

    let position = policy
        .allowed_recipients
        .iter()
        .position(|r| r == &recipient)
        .ok_or(ErrorCode::RecipientNotFound)?;
    policy.allowed_recipients.remove(position);

    msg!("Recipient {} removed from policy allow list", recipient);
    Ok(())
}
