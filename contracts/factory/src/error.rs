use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FactoryError {
    NotFound = 1,
    Paused = 2,
    InvalidConfig = 3,
    StrategyNotFound = 4,
    StrategyDisabled = 5,
    StrategyExists = 6,
    InvalidStrategy = 7,
    NotEscrow = 8,
    TooMany = 9,
    InvalidAmount = 10,
    InvalidEndTs = 11,
    InvalidInvite = 12,
    InvalidParty = 13,
    InvalidBps = 14, // sin uso desde #16; se conserva el número
    AlreadyRegistered = 15,
    SameParty = 16,
    Arithmetic = 17,
    VaultFeeTooHigh = 18,
    VaultNotPlatformManaged = 19,
    NonceUsed = 20,
    ConfigChanged = 21,
}
