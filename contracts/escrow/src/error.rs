// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/error.rs), modified. See contracts/escrow/NOTICE.md
// FIANZAS: `EscrowError` y `MilestoneError` del upstream se solapaban en los códigos. Se
// sustituyen por un único enum con códigos únicos (docs/INTERFACES.md § 2).
use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    BadStatus = 1,
    NotParty = 2,
    AlreadyApproved = 3,
    TimeoutNotReached = 4,
    InvalidBps = 5,
    InvalidAmount = 6,
    DeductionTooHigh = 7,
    VaultError = 8,
    InvalidInvite = 9,
    DeadlinePassed = 10,
    SameParty = 11,
    InvalidEndTs = 12,
    ReportMissing = 13,
    InvalidParty = 14,
    IncoherentResolution = 15,
    InsufficientBond = 16,
    TermsMismatch = 17,
    NotResolver = 18,
    ReviewTimeoutNotReached = 19,
    ReviewDeadlinePassed = 20,
    Paused = 21,
    Arithmetic = 22,
    InvalidConfig = 23,
    FactoryCall = 24,
    VaultFeeChanged = 25,
}
