//! Llamadas del escrow al vault de DeFindex. Los importes y las shares se miden siempre por
//! diferencia de balance; el retorno de `deposit` y `withdraw` se ignora (INTERFACES § 5).
use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{vec, Address, Env, IntoVal, Symbol, Val, Vec};

use crate::error::EscrowError;

fn shares_of(e: &Env, vault: &Address, owner: &Address) -> Result<i128, EscrowError> {
    let args: Vec<Val> = vec![e, owner.into_val(e)];
    match e.try_invoke_contract::<i128, soroban_sdk::Error>(vault, &Symbol::new(e, "balance"), args)
    {
        Ok(Ok(shares)) => Ok(shares),
        _ => Err(EscrowError::VaultError),
    }
}

/// Deposita `amount` del escrow en el vault con `invest = true` y devuelve las shares
/// recibidas. El escrow solo autoriza `token.transfer(escrow, vault, amount)`.
pub fn deposit_all(
    e: &Env,
    vault: &Address,
    token: &Address,
    amount: i128,
) -> Result<i128, EscrowError> {
    let me = e.current_contract_address();
    let token_client = TokenClient::new(e, token);
    let balance_before = token_client.balance(&me);
    let shares_before = shares_of(e, vault, &me)?;

    e.authorize_as_current_contract(vec![
        e,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: token.clone(),
                fn_name: Symbol::new(e, "transfer"),
                args: (me.clone(), vault.clone(), amount).into_val(e),
            },
            sub_invocations: vec![e],
        }),
    ]);
    let amounts = vec![e, amount];
    let args: Vec<Val> = vec![
        e,
        amounts.into_val(e),
        amounts.into_val(e),
        me.into_val(e),
        true.into_val(e),
    ];
    match e.try_invoke_contract::<Val, soroban_sdk::Error>(vault, &Symbol::new(e, "deposit"), args)
    {
        Ok(Ok(_)) => {}
        _ => return Err(EscrowError::VaultError),
    }

    // CT-8: el vault se ha llevado exactamente `amount`, ni más ni menos.
    let spent = balance_before
        .checked_sub(token_client.balance(&me))
        .ok_or(EscrowError::Arithmetic)?;
    if spent != amount {
        return Err(EscrowError::VaultError);
    }
    let shares = shares_of(e, vault, &me)?
        .checked_sub(shares_before)
        .ok_or(EscrowError::Arithmetic)?;
    if shares <= 0 {
        return Err(EscrowError::VaultError);
    }
    Ok(shares)
}

/// Retira todas las shares y devuelve lo recibido en el token, medido por diferencia.
/// `min_amounts_out = 0` a propósito: una pérdida no debe bloquear la salida.
pub fn withdraw_all(
    e: &Env,
    vault: &Address,
    token: &Address,
    shares: i128,
) -> Result<i128, EscrowError> {
    if shares == 0 {
        return Ok(0);
    }
    let me = e.current_contract_address();
    let token_client = TokenClient::new(e, token);
    let before = token_client.balance(&me);
    let args: Vec<Val> = vec![
        e,
        shares.into_val(e),
        vec![e, 0i128].into_val(e),
        me.into_val(e),
    ];
    match e.try_invoke_contract::<Val, soroban_sdk::Error>(vault, &Symbol::new(e, "withdraw"), args)
    {
        Ok(Ok(_)) => {}
        _ => return Err(EscrowError::VaultError),
    }
    token_client
        .balance(&me)
        .checked_sub(before)
        .ok_or(EscrowError::Arithmetic)
}

/// Valor actual de `shares` en el token. 0 si el vault falla (CT-10): las lecturas nunca
/// se bloquean por el vault.
pub fn preview_value(e: &Env, vault: &Address, shares: i128) -> i128 {
    if shares == 0 {
        return 0;
    }
    let args: Vec<Val> = vec![e, shares.into_val(e)];
    match e.try_invoke_contract::<Vec<i128>, soroban_sdk::Error>(
        vault,
        &Symbol::new(e, "get_asset_amounts_per_shares"),
        args,
    ) {
        Ok(Ok(amounts)) => amounts.get(0).unwrap_or(0),
        _ => 0,
    }
}

/// `(vault_fee_bps, protocol_fee_bps)` o `None` si el vault no responde.
pub fn current_fees(e: &Env, vault: &Address) -> Option<(u32, u32)> {
    let args: Vec<Val> = vec![e];
    match e.try_invoke_contract::<(u32, u32), soroban_sdk::Error>(
        vault,
        &Symbol::new(e, "get_fees"),
        args,
    ) {
        Ok(Ok(fees)) => Some(fees),
        _ => None,
    }
}
