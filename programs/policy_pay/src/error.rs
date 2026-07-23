use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Only the policy owner can perform this action")]
    Unauthorized,
    #[msg("Only the designated agent can execute payments")]
    NotAgent,
    #[msg("Recipient is not on the policy's allow list")]
    RecipientNotAllowed,
    #[msg("Payment would exceed the policy's budget limit")]
    BudgetExceeded,
    #[msg("Vault balance is insufficient to cover this payment and stay rent-exempt")]
    InsufficientVaultBalance,
}
