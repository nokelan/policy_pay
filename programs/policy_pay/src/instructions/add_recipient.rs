use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode, state::Policy};

#[derive(Accounts)]
pub struct AddRecipient<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner,
    )]
    pub policy: Account<'info, Policy>,
}

pub fn handle_add_recipient(ctx: Context<AddRecipient>, recipient: Pubkey) -> Result<()> {
    let policy = &mut ctx.accounts.policy;

    require!(
        !policy.allowed_recipients.contains(&recipient),
        ErrorCode::RecipientAlreadyRegistered
    );
    require!(
        policy.allowed_recipients.len() < MAX_RECIPIENTS,
        ErrorCode::RecipientListFull
    );

    policy.allowed_recipients.push(recipient);

    msg!("Recipient {} added to policy allow list", recipient);
    Ok(())
}
