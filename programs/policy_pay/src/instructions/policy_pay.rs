use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode, events::PaymentExecuted, state::Policy};

#[derive(Accounts)]
pub struct PolicyPay<'info> {
    pub agent: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, policy.owner.as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, Policy>,
    /// CHECK: validated against policy.allowed_recipient below
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

pub fn handle_policy_pay(ctx: Context<PolicyPay>, amount: u64) -> Result<()> {
    let policy = &mut ctx.accounts.policy;

    require_keys_eq!(policy.agent, ctx.accounts.agent.key(), ErrorCode::NotAgent);
    require!(
        policy.allowed_recipients.contains(&ctx.accounts.recipient.key()),
        ErrorCode::RecipientNotAllowed
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now <= policy.valid_until, ErrorCode::PolicyExpired);
    require!(amount <= policy.max_per_tx, ErrorCode::PerTxLimitExceeded);

    if now - policy.period_start >= PERIOD_SECONDS {
        policy.spent = 0;
        policy.period_start = now;
    }

    let new_spent = policy
        .spent
        .checked_add(amount)
        .ok_or(ErrorCode::BudgetExceeded)?;
    require!(new_spent <= policy.budget_limit, ErrorCode::BudgetExceeded);

    // budget_limit only tracks the spending cap, not the actual vault balance,
    // so a payment within budget can still exceed what was ever deposited.
    // Check the vault can cover it and stay rent-exempt before debiting.
    let rent_exempt_min = Rent::get()?.minimum_balance(policy.to_account_info().data_len());
    let vault_balance = policy.to_account_info().lamports();
    require!(
        vault_balance >= rent_exempt_min + amount,
        ErrorCode::InsufficientVaultBalance
    );

    **policy.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.recipient.try_borrow_mut_lamports()? += amount;
    policy.spent = new_spent;

    emit!(PaymentExecuted {
        policy: policy.key(),
        recipient: ctx.accounts.recipient.key(),
        amount,
        timestamp: now,
    });

    msg!("Paid {} lamports to {}", amount, ctx.accounts.recipient.key());
    Ok(())
}
