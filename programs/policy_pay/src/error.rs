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
    #[msg("Payment amount exceeds the policy's per-transaction limit")]
    PerTxLimitExceeded,
    #[msg("Policy has expired")]
    PolicyExpired,
    #[msg("Policy already has the maximum number of allowed recipients")]
    RecipientListFull,
    #[msg("Recipient is already on the policy's allow list")]
    RecipientAlreadyRegistered,
    #[msg("Recipient is not currently on the policy's allow list")]
    RecipientNotFound,
}
