# Interfaces

**Estado: BORRADOR v3. Se congela en G1 (hora 2).** A partir de ahí, cualquier cambio necesita un issue "Cambio de interfaz" y la aprobación del dueño de cada área afectada. Editar este archivo requiere `/lock interfaces`.

Fuente: `.kiro/pipeline/architecture.md` § 6 (fork de Trustless Work + DeFindex + `FianzaFactory` + API compatible), con los ajustes de seguridad de `.kiro/pipeline/security.md` aplicados. Si hay discrepancia, manda este archivo.

Resumen: cada fianza es un contrato **escrow** (fork del Single-Release v2 de Trustless Work, ver `NOTICE.md`) creado por **`FianzaFactory`**. Al fondear, el escrow deposita la fianza en un vault de **DeFindex** (por defecto, Blend Fixed Pool USDC). Al liquidar, la retira al escrow y la reparte con `split()`. Todas las comisiones (plataforma, Trustless Work y DeFindex) quedan fijadas en los `Terms` al crear la fianza. Front e integradores usan nuestra **API compatible con la Core API v2 de Trustless Work** (§ 8 de la arquitectura → aquí, sección "API").

Convenciones: importes `i128` en la unidad mínima del token (7 decimales) y porcentajes en bps (10000 = 100 %). Constantes: `MAX_AMOUNT = 10^15`, `MAX_TERM_SECS = 3 × 365 × 86400`, `MAX_BATCH = 10`, `MAX_PAGE = 50`, `MAX_VIEWS = 25`.

## 1. Correspondencia de roles de Trustless Work [AD-14]

| Rol TW v2 | Valor en cada fianza | Cómo se fija | Nota |
|---|---|---|---|
| `approvers` (quórum `target = 2`) | `[landlord, tenant]` | `landlord` al crear; `tenant` se añade en `fund_escrow` | Liberación con las dos firmas, sin orden. **Alternativa con v1:** approver = casero (`approve`) y `release_signer` = inquilino (la 2.ª firma libera). |
| `release_signers` | `= approvers` | — | La liberación se ejecuta dentro de la aprobación que alcanza el quórum (semántica de `approve_and_release_milestones`). |
| `service_providers` | `[landlord]` | al crear | Obligatorio no vacío en v2. Sin milestones, no tiene funciones. |
| `dispute_resolvers` | `config.staff` (1–3 direcciones) | copia en `Terms` al crear | Cualquiera de ellos puede resolver. Varias direcciones mitigan el staff ausente. Inmutable por fianza. |
| `platform` | `config.treasury` | copia en `Terms` | Recibe `platform_fee` (del rendimiento) y el bond perdido. |
| `receiver` | `tenant` | en `fund_escrow` | Principal − deducción + su parte del rendimiento. **Receptores adicionales del fork:** `landlord` (deducción + su parte + bond devuelto) y `tw_fee_receiver`. |
| `admin` | dirección de la factory | constructor | **Sin poderes** en el escrow (no hay `update_escrow`). Solo identifica el origen. |
| `observers` | `[]` | — | Las lecturas son públicas. |
| (no existe en TW) | `claim_after_timeout`, `claim_after_review_timeout`, stop bond y vault | — | Extensiones del fork. |

**Vinculación del inquilino invitado** (se mantiene [AD-3] y FR-2):
1. El navegador del casero genera `code = getRandomValues(32 B)` e `invite_hash = sha256(code)`, y llama a `create_fianza(landlord, { tenant: None, invite_hash: Some(h), … })`.
2. Enlace: `https://<dominio>/i/<id>#c=<base64url(code)>`. El **`id`** se resuelve a la dirección del escrow con `factory.escrow_of(id)`, nunca desde la URL (WEB-2 y WEB-11).
3. El inquilino crea su passkey, lee `get_terms()`, ve las condiciones y la estrategia con su aviso de riesgo, y firma `fund_escrow(tenant, Some(code), expected_terms)`. Antes de pedir la passkey, el front comprueba que `terms.factory`, `terms.treasury`, `terms.dispute_resolvers`, `terms.strategy.vault` y `terms.tw_fee_bps`, `terms.defindex_vault_fee_bps` coinciden con `deployments/testnet.json`. Si no coinciden, no deja fondear (security WEB-14).
4. El escrow comprueba `sha256(code) == invite_hash`, fija `tenant`, `approvers += tenant` y llama a `factory.register_tenant(id, tenant)`, que comprueba que el llamante es `escrow_of(id)` y añade el id al índice del inquilino.
5. Si el casero conoce la dirección (`tenant: Some(t)`, `invite_hash: None`), `fund_escrow` exige `tenant == t`. Exactamente uno de los dos debe estar presente.

## 2. Contrato `escrow` (fork, P1)

### Tipos (`storage/types.rs`)
```rust
#[contracttype] #[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status { Proposed, Active, Ending /* DERIVADO, nunca se almacena */, Stopped, UnderReview, Settled, Cancelled }

#[contracttype] #[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SettlePath { Approved, Resolved, Timeout, ReviewTimeout }

#[contracttype] #[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyKind { NoYield, DeFindexVault }

#[contracttype] #[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RiskTier { NoYield, Standard, High }   // NINGUNO significa "sin riesgo" (ver § 7)

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Strategy {
    pub id: Symbol,               // "usdc_fixed", "usdc_mock", "custody", …
    pub kind: StrategyKind,
    pub vault: Option<Address>,   // Some ⇔ DeFindexVault (el vault al que deposita el escrow)
    pub asset: Address,           // token de la fianza; == config.token (USDC)
    pub asset_name: String,       // "USDC:G…" = name() del SAC, informativo. El control real es asset == config.token;
                                  // deploy.mjs verifica que config.token es el SAC del emisor oficial (security N-4)
    pub defindex_strategy: Option<Address>, // estrategia subyacente del vault (informativo, para el front)
    pub apy_pool: Option<Address>,          // pool de Blend del que el front lee el supply APY en vivo
    pub risk: RiskTier,
    pub simulated: bool,          // true ⇔ mock-vault (NFR-11: la UI lo etiqueta)
    pub enabled: bool,            // false ⇒ no se usa en fianzas NUEVAS; las existentes no se tocan
    pub max_vault_fee_bps: u32,   // tope de la comisión del vault DeFindex (sobre ganancias) que se admite; 0 si NoYield
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Terms {                // inmutable desde el constructor; el inquilino lo firma en fund_escrow
    pub factory: Address,
    pub id: u64,
    pub landlord: Address,
    pub amount: i128,
    pub end_ts: u64,
    pub tenant_yield_bps: u32,
    pub strategy: Strategy,       // snapshot
    pub platform_fee_bps: u32,    // sobre el rendimiento
    pub tw_fee_bps: u32,          // sobre el rendimiento (Q-16)
    pub tw_fee_receiver: Option<Address>,
    pub defindex_vault_fee_bps: u32,    // SNAPSHOT de vault.get_fees().0 al crear (0 si NoYield). Lo cobra el vault, no split()
    pub defindex_protocol_fee_bps: u32, // SNAPSHOT de vault.get_fees().1 al crear (0 si NoYield). Ídem
    pub treasury: Address,
    pub dispute_resolvers: Vec<Address>,
    pub timeout_secs: u64,
    pub review_timeout_secs: u64,
    pub stop_bond: i128,          // min(max(min, amount·bps/10000), amount), calculado por la factory
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowInit { pub terms: Terms, pub tenant: Option<Address>, pub invite_hash: Option<BytesN<32>> }

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Approvals { pub target: u32, pub approval_count: u32, pub approved_by: Vec<Address> } // = MilestoneApprovals (TW v2)

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub reason_hash: Option<BytesN<32>>,   // sha256(sal ‖ motivo), DAT-2
    pub stopped_ts: u64,                   // 0 si no hubo parada
    pub expert_ref: Option<BytesN<32>>,
    pub report_hash: Option<BytesN<32>>,
    pub bond_held: i128,
    pub stop_justified: Option<bool>,      // Some al resolver; None en ReviewTimeout
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settlement {
    pub total: i128,          // retirado del vault (o principal líquido si NoYield)
    pub yield_total: i128,    // max(total − amount, 0)
    pub deduction: i128,      // efectiva, tras el recorte de CT-7
    pub to_tenant: i128,
    pub to_landlord: i128,
    pub to_treasury: i128,    // platform fee (NO incluye el bond)
    pub to_tw: i128,          // fee de TW sobre el rendimiento
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    pub terms: Terms,
    pub tenant: Option<Address>,
    pub invite_hash: Option<BytesN<32>>,
    pub status: Status,                    // almacenado (nunca Ending)
    pub approvals: Approvals,              // target = 2
    pub shares: i128,                      // shares del vault (0 si NoYield)
    pub created_ts: u64,
    pub funded_ts: u64,
    pub dispute: Dispute,
    pub settlement: Option<Settlement>,
    pub path: Option<SettlePath>,
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Roles {                         // forma TW v2, calculada (no se almacena)
    pub approvers: Vec<Address>, pub service_providers: Vec<Address>, pub platform: Address,
    pub release_signers: Vec<Address>, pub dispute_resolvers: Vec<Address>,
    pub receiver: Option<Address>, pub admin: Address, pub observers: Vec<Address>,
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowView {
    pub data: Escrow,
    pub status: Status,         // EFECTIVO (Ending incluido)
    pub accrued_yield: i128,    // estimación bruta; 0 si el vault falla (CT-10)
    pub timeout_at: u64,        // end_ts + timeout_secs
    pub review_deadline: u64,   // stopped_ts + review_timeout_secs, o 0
}
```

### Funciones

| Función | `require_auth` | Precondiciones (error) | Estado |
|---|---|---|---|
| `__constructor(init: EscrowInit)` | — (solo la despliega la factory; ver R-3) | `amount ∈ (0, MAX_AMOUNT]`; `end_ts > now`; bps válidos; `platform_fee_bps + tw_fee_bps ≤ 10000`; exactamente uno de `tenant`/`invite_hash`; `dispute_resolvers` 1–3 sin duplicados; si `tw_fee_bps > 0`, hay `tw_fee_receiver`. Si falla: `panic_with_error!` | — → `Proposed`. `approvals = {target: 2, count: 0, by: []}` |
| `cancel()` | `terms.landlord` | `Proposed` (BadStatus) | → `Cancelled` |
| `fund_escrow(tenant: Address, invite_code: Option<BytesN<32>>, expected_terms: Terms) -> i128` (shares) | `tenant` (+ `token.transfer(tenant, escrow, amount)` anidado) | `Proposed`; `now < end_ts` (InvalidEndTs); `expected_terms == terms` (TermsMismatch); invitación (InvalidInvite) o `tenant == fijado` (NotParty); `tenant ≠ landlord` (SameParty); partes (InvalidParty); `factory.funding_allowed(strategy.id)` (Paused); si hay vault: `vault.get_fees()` **≤ snapshot** en las dos componentes (VaultFeeChanged, § 9); transferencia medida `== amount` (InvalidAmount); shares > 0 (VaultError). Las llamadas a la factory (`funding_allowed`, `register_tenant`) van con `try_`: si fallan, FactoryCall (security N-1) | `Proposed` → `Active` |
| `approve_release(approver: Address) -> Option<Settlement>` | `approver` | `approver ∈ {landlord, tenant}` (NotParty); almacenado `Active` (BadStatus); no aprobado ya (AlreadyApproved). Vale antes y después de `end_ts`, y también tras el plazo | `Active` → (al llegar a 2) `Settled`, `Approved` |
| `stop(reason_hash: BytesN<32>)` | `terms.landlord` (+ `token.transfer(landlord, escrow, stop_bond)` anidado) | `Active` (BadStatus); el casero no aprobó (AlreadyApproved); `now ≤ timeout_at` (DeadlinePassed); `balance(landlord) ≥ stop_bond` (InsufficientBond). **La pausa no lo bloquea** | `Active` → `Stopped` |
| `assign_expert(resolver: Address, expert_ref: BytesN<32>)` | `resolver` | `resolver ∈ dispute_resolvers` (NotResolver); `Stopped` o `UnderReview` (BadStatus). Al reasignar borra `report_hash` | → `UnderReview` |
| `record_report(resolver: Address, report_hash: BytesN<32>)` | `resolver` | NotResolver; `UnderReview` | `UnderReview` |
| `resolve(resolver: Address, deduction: i128, stop_justified: bool) -> Settlement` | `resolver` | NotResolver; `UnderReview`; `now ≤ review_deadline` (ReviewDeadlinePassed); `report_hash` (ReportMissing); `0 ≤ deduction ≤ amount` (InvalidAmount/DeductionTooHigh); `!stop_justified ⇒ deduction == 0` (IncoherentResolution) | → `Settled`, `Resolved` (+ bond) |
| `claim_after_timeout() -> Settlement` | **ninguna** | `Active` (BadStatus); `now > timeout_at` (TimeoutNotReached) | → `Settled`, `Timeout` |
| `claim_after_review_timeout() -> Settlement` | **ninguna** | `Stopped` o `UnderReview` (BadStatus); `now > review_deadline` (ReviewTimeoutNotReached) | → `Settled`, `ReviewTimeout`; bond → casero |
| `extend_contract_ttl()` | ninguna | — | instancia y código a `max_ttl` |
| `get_escrow() -> Escrow` | — | — (sin llamadas externas) | lectura |
| `get_terms() -> Terms` | — | — | lectura |
| `get_roles() -> Roles` | — | forma TW v2 | lectura |
| `get_view() -> EscrowView` | — | llama al vault con `try_` | lectura |
| `accrued_yield() -> i128` | — | `max(preview − amount, 0)`; 0 si `NoYield`, sin fondos o con fallo | lectura |
| `preview_settlement(deduction: i128) -> Settlement` | — | estado con fondos; mismo `split()` | lectura |

**Bordes temporales complementarios** (CT-4 ampliado): `Ending ⇔ Active ∧ now ≥ end_ts`; `stop ⇔ now ≤ timeout_at`; `claim_after_timeout ⇔ now > timeout_at`; `resolve ⇔ now ≤ review_deadline`; `claim_after_review_timeout ⇔ now > review_deadline`. Para un mismo `now`, nunca pueden ejecutarse a la vez dos caminos que compitan.

**Superficie del contrato** (security N-2): el wasm del escrow exporta **exactamente** las funciones de esta tabla. No queda ninguna función del upstream de TW (`tw_new_single_release_escrow`, `initialize_escrow`, `update_escrow`, `manage_milestones`, `release_funds`, `change_milestone_status`, `approve_milestones`, `approve_and_release_milestones`, `resolve_dispute`, `dispute_escrow`, `withdraw_remaining_funds`, `extend_contract_ttl(admin, …)`, `get_escrow_by_contract_id`, `get_multiple_escrow_balances`) ni ninguna de upgrade. `scripts/` lo comprueba con `stellar contract info interface`.

### Eventos (`#[contractevent]`, data con nombres; topic 0 = nombre y topic 1 = `id`)
| Topic 0 | Data |
|---|---|
| `fz_init` | `factory, landlord, amount, end_ts, tenant_yield_bps, strategy_id, stop_bond, has_invite: bool, platform_fee_bps, tw_fee_bps, defindex_vault_fee_bps, defindex_protocol_fee_bps` |
| `fz_cancel` | `landlord` |
| `fz_fund` | `tenant, amount, shares` |
| `fz_approve` | `approver, approval_count` |
| `fz_stop` | `landlord, reason_hash, bond` |
| `fz_expert` | `resolver, expert_ref` |
| `fz_report` | `resolver, report_hash` |
| `fz_settle` | `settlement: Settlement, path: SettlePath, vault_fees_at_settle: Option<(u32, u32)>` (lectura con `try_` de `get_fees()` para reporting; **nunca** bloquea la salida) |
| `fz_bond` | `to, amount, justified: Option<bool>` (`None` en ReviewTimeout) |

### Errores (`error.rs`, único enum)
```rust
#[contracterror] #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)] #[repr(u32)]
pub enum EscrowError {
    BadStatus = 1, NotParty = 2, AlreadyApproved = 3, TimeoutNotReached = 4,
    InvalidBps = 5, InvalidAmount = 6, DeductionTooHigh = 7, VaultError = 8,
    InvalidInvite = 9, DeadlinePassed = 10, SameParty = 11, InvalidEndTs = 12,
    ReportMissing = 13, InvalidParty = 14, IncoherentResolution = 15, InsufficientBond = 16,
    TermsMismatch = 17, NotResolver = 18, ReviewTimeoutNotReached = 19, ReviewDeadlinePassed = 20,
    Paused = 21, Arithmetic = 22, InvalidConfig = 23, FactoryCall = 24,   // una llamada a la factory falló dentro de fund_escrow (security N-1)
    VaultFeeChanged = 25,
}
```

## 3. Contrato `FianzaFactory` (nuevo, P1)

### Tipos (importa `Strategy`, `StrategyKind`, `RiskTier`, `Terms`, `EscrowInit`, `Escrow` y `Status` del escrow con `contractimport!`)
```rust
#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalConfig {
    pub token: Address,                 // USDC del vault por defecto
    pub treasury: Address,              // platform de TW
    pub staff: Vec<Address>,            // 1..=3 → dispute_resolvers de las fianzas NUEVAS
    pub platform_fee_bps: u32,          // demo 2000; ≤ 5000
    pub tw_fee_bps: u32,                // MVP: 0 (no se cobra). Si TW lo acuerda: 30, solo sobre el rendimiento (Q-16)
    pub tw_fee_receiver: Option<Address>,
    pub timeout_secs: u64,              // demo 120; prod 30 días; ≥ 60
    pub review_timeout_secs: u64,       // demo 300; prod 30 días; ≥ 60
    pub stop_bond_min: i128,            // demo 100_000_000 (10 USDC); 0..=MAX_AMOUNT
    pub stop_bond_bps: u32,             // demo 500; ≤ 2000
    pub vault_manager: Option<Address>, // Some ⇒ add_strategy exige vault.get_manager() == esto (vaults propios; mainnet). Testnet: None
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct FianzaParams {
    pub tenant: Option<Address>,
    pub invite_hash: Option<BytesN<32>>,
    pub amount: i128,
    pub end_ts: u64,
    pub tenant_yield_bps: u32,          // preset de país (INTERFACES § 6)
    pub strategy_id: Option<Symbol>,    // None → estrategia por defecto
    pub nonce: BytesN<32>,              // salt = sha256(landlord ‖ nonce): dirección del escrow conocida ANTES de firmar (compatibilidad con el `contractId` del deploy de TW)
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Created { pub id: u64, pub escrow: Address }

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct FianzaSummary { pub id: u64, pub escrow: Address, pub data: Escrow, pub status: Status /* efectivo */ }
```

### Funciones
| Función | Auth | Precondiciones (error) | Efecto |
|---|---|---|---|
| `__constructor(admin, escrow_wasm_hash: BytesN<32>, config: GlobalConfig)` | — | config válida (InvalidConfig) | — |
| `create_fianza(landlord: Address, p: FianzaParams) -> Created` | `landlord` | no pausada (Paused); estrategia existe (StrategyNotFound) y `enabled` (StrategyDisabled); `amount ∈ (0, MAX_AMOUNT]` (InvalidAmount); `now < end_ts ≤ now + MAX_TERM_SECS` (InvalidEndTs); `tenant_yield_bps ≤ 10000` (InvalidBps); exactamente uno de `tenant`/`invite_hash` (InvalidInvite); `landlord`/`tenant` ∉ {staff, treasury, factory, token, vault, tw_fee_receiver} (InvalidParty); `tenant ≠ landlord` (SameParty); si hay vault: `(vf, pf) = vault.get_fees()` con `vf ≤ strategy.max_vault_fee_bps` y `pf ≤ 10000` (VaultFeeTooHigh) | `id = next_id`; `salt = sha256(landlord ‖ nonce)` (dirección ya ocupada → `NonceUsed`); `deployer().with_current_contract(salt).deploy_v2(wasm_hash, (EscrowInit,))` con `Terms.defindex_vault_fee_bps = vf` y `defindex_protocol_fee_bps = pf`; registra `Escrow(id)`, `IdOf(addr)` e índice del casero; evento `f_created` |
| `predict_address(landlord, nonce) -> Address` | — | — | dirección que tendrá el escrow (`deployer().with_current_contract(salt).deployed_address()`); la usa la API para devolver `contractId` en el build |
| `create_fianzas_batch(landlord, items: Vec<FianzaParams>) -> Vec<Created>` **[Could]** | `landlord` (una sola firma) | `1 ≤ len ≤ MAX_BATCH` (TooMany); cada item como arriba; atómica | N despliegues. El límite real lo mide el spike (§ 10) |
| `register_tenant(id: u64, tenant: Address)` | **el escrow** (`escrow_of(id).require_auth()`, implícita al ser invocador directo) | `escrow_of(id)` existe (NotFound); el llamante es ese escrow (NotEscrow); no registrado (AlreadyRegistered) | índice del inquilino; evento `f_tenant` |
| `funding_allowed(strategy_id: Symbol) -> bool` | — | — | `!paused ∧ strategy.enabled` |
| `set_escrow_wasm_hash(hash: BytesN<32>)` | admin | — | solo afecta a fianzas **nuevas**; evento `f_wasm {old, new}` |
| `set_config(config: GlobalConfig)` | admin | válida (InvalidConfig) | solo fianzas nuevas; evento `f_config` |
| `add_strategy(s: Strategy)` | admin | `id` nuevo (StrategyExists); `≤ 10` estrategias (TooMany); `kind == DeFindexVault ⇔ vault.is_some()`; `kind == NoYield ⇒ risk == NoYield`; `vault ∉ {token, factory, treasury, staff}`; `asset == config.token` **y** `token::Client(asset).name() == s.asset_name` (fija el emisor exacto; InvalidStrategy); `max_vault_fee_bps ≤ 2000` y `vault.get_fees().0 ≤ max_vault_fee_bps` (VaultFeeTooHigh); si `config.vault_manager = Some(m)`: `vault.get_manager() == m` (VaultNotPlatformManaged); se guarda con `enabled = false` hasta que el admin lo habilite (dos pasos, para revisar el evento antes) | evento `f_strategy` |
| `set_strategy_enabled(id: Symbol, enabled: bool)` | admin | existe; no se puede deshabilitar la estrategia por defecto sin cambiarla antes | deshabilitar bloquea **altas y fondeos nuevos**; las fianzas ya creadas conservan su snapshot y sus salidas; evento |
| `set_default_strategy(id: Symbol)` | admin | existe y `enabled` | exactamente una por defecto; evento |
| `pause()` / `unpause()` | admin | — | bloquea `create_*` y `fund_escrow` (vía `funding_allowed`); eventos `f_paused`/`f_unpaused` |
| `config() -> GlobalConfig`, `escrow_wasm_hash() -> BytesN<32>`, `paused() -> bool`, `admin() -> Address` | — | — | lectura |
| `strategies() -> Vec<Strategy>`, `strategy(id) -> Strategy`, `default_strategy() -> Strategy` | — | NotFound | lectura |
| `count() -> u64` | — | último id (ids `1..=count`) | lectura |
| `escrow_of(id) -> Address`, `id_of(escrow: Address) -> u64` | — | NotFound | lectura (fuente de verdad para el front y el Relayer) |
| `list_by_landlord(landlord, start: u32, limit: u32) -> Vec<u64>` | — | `limit ≤ MAX_PAGE` | lectura paginada |
| `list_by_tenant(tenant, start: u32, limit: u32) -> Vec<u64>` | — | igual | lectura paginada |
| `count_by_landlord(landlord) -> u32`, `count_by_tenant(tenant) -> u32` | — | — | lectura |
| `get_fianzas(ids: Vec<u64>) -> Vec<FianzaSummary>` | — | `len ≤ MAX_VIEWS` (TooMany); omite ids inexistentes | `escrow.get_escrow()` por id, **sin llamar al vault** (presupuesto, § 8.3) |

`compute_stop_bond(amount, min, bps) = min(max(min, floor(amount × bps / 10000)), amount)` vive **solo** en `factory/src/bond.rs`. La factory lo calcula y lo copia en `Terms.stop_bond`.

**Storage de la factory:** instance: `Admin`, `WasmHash`, `Config`, `Paused`, `NextId`, `DefaultStrategy`, `StrategyIds: Vec<Symbol>` (≤ 10). persistent (con `extend_ttl` en cada escritura): `Strategy(Symbol)`, `Escrow(u64) → Address`, `IdOf(Address) → u64`, `LandlordCount(Address) → u32`, `LandlordAt(Address, u32) → u64`, `TenantCount(Address) → u32`, `TenantAt(Address, u32) → u64`.

**Eventos** (topic 0 = nombre, topic 1 = `id` cuando aplica): `f_created {escrow, landlord, amount, strategy_id, defindex_vault_fee_bps, defindex_protocol_fee_bps}`, `f_tenant {tenant}`, `f_wasm {old, new}`, `f_config {config}`, `f_strategy {id, enabled, is_default, risk, max_vault_fee_bps}`, `f_paused {admin}`, `f_unpaused {admin}`.

**Errores**
```rust
#[contracterror] #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)] #[repr(u32)]
pub enum FactoryError {
    NotFound = 1, Paused = 2, InvalidConfig = 3, StrategyNotFound = 4, StrategyDisabled = 5,
    StrategyExists = 6, InvalidStrategy = 7, NotEscrow = 8, TooMany = 9, InvalidAmount = 10,
    InvalidEndTs = 11, InvalidInvite = 12, InvalidParty = 13, InvalidBps = 14,
    AlreadyRegistered = 15, SameParty = 16, Arithmetic = 17,
    VaultFeeTooHigh = 18, VaultNotPlatformManaged = 19, NonceUsed = 20,
}
```
Validación de `GlobalConfig`: `platform_fee_bps + tw_fee_bps ≤ 10000`, `platform_fee_bps ≤ 5000`, `stop_bond_bps ≤ 2000`, `timeout_secs ≥ 60`, `review_timeout_secs ≥ 60`, `staff` de 1 a 3 sin duplicados, `treasury ∉ staff`, `tw_fee_bps > 0 ⇒ tw_fee_receiver.is_some()` y `staff`, `treasury` ≠ factory.

## 4. Reparto (`modules/split`, puro) [AD-15]

```
pre: amount > 0, total ≥ 0, 0 ≤ deduction, platform_bps + tw_bps ≤ 10000, tenant_bps ≤ 10000
principal_back = min(total, amount)
deduction      = min(deduction, principal_back)          // el recorte lo hace settle (CT-7); split lo exige
yield          = max(total − amount, 0)                  // la pérdida se compensa PRIMERO con el rendimiento
tw             = floor(yield × tw_bps / 10000)           // fee de TW: solo sobre el rendimiento; MVP tw_bps = 0 (Q-16)
fee            = floor(yield × platform_bps / 10000)     // fee de plataforma: solo sobre el rendimiento
net            = yield − tw − fee
landlord_yield = floor(net × (10000 − tenant_bps) / 10000)
tenant_yield   = net − landlord_yield                    // el resto del redondeo, al inquilino
to_landlord    = deduction + landlord_yield
to_tenant      = principal_back − deduction + tenant_yield   // un déficit de principal recae aquí (Q-13)
to_treasury    = fee
to_tw          = tw
post: to_tenant + to_landlord + to_treasury + to_tw == total   (si no, panic: es un bug)
```
- Los dos fees se calculan **sobre el rendimiento bruto**, igual que TW los calcula sobre el bruto del escrow. Así el reparto conserva la forma "bruto − fee TW − fee plataforma = neto", pero aplicada solo al rendimiento.
- **El principal nunca paga fees.** Con `yield = 0`: `to_treasury = to_tw = 0` y el inquilino recibe `amount − deduction` (AC-7).
- El **bond** queda fuera de `Settlement` y se paga después (security 12.7).
- `NoYield`: `total = amount` (principal líquido en el escrow) → `yield = 0`.
- Matriz obligatoria (AC-1 ampliado): `tenant_bps ∈ {0, 5000, 10000}` × `deduction ∈ {0, parcial, amount}` × `vault ∈ {ganancia, pérdida < rendimiento, pérdida > rendimiento, pérdida total}` × `tw_bps ∈ {0 (MVP), 30}`.

## 5. Subconjunto del vault de DeFindex (lo usa el escrow; lo implementa `mock-vault`)

Firmas verificadas en `paltalabs/defindex/apps/contracts/vault/src/lib.rs`:
```rust
// El vault es además el token SEP-41 de sus shares (dfTokens).
fn deposit(e: Env, amounts_desired: Vec<i128>, amounts_min: Vec<i128>, from: Address, invest: bool)
    -> Result<(Vec<i128>, i128, Option<Vec<Option<AssetInvestmentAllocation>>>), ContractError>;
fn withdraw(e: Env, withdraw_shares: i128, min_amounts_out: Vec<i128>, from: Address) -> Result<Vec<i128>, ContractError>;
fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Result<Vec<i128>, ContractError>;
fn balance(e: Env, id: Address) -> i128;
fn get_fees(e: Env) -> (u32, u32);                          // (vault_fee_bps, defindex_protocol_fee_bps)
fn get_manager(e: Env) -> Result<Address, ContractError>;   // solo lo usa la factory en add_strategy
```
**Cómo lo usa el escrow (`modules/vault/defindex.rs`):**
- **deposit_all:** `authorize_as_current_contract([token.transfer(escrow, vault, amount)])`, después `try_invoke_contract::<Val, Error>(vault, "deposit", ([amount], [amount], escrow, true))`. **Se ignora el retorno** y se miden las shares con `balance(escrow)` antes y después (`> 0`, o `VaultError`). Con `invest = true` el vault invierte en sus estrategias en la misma transacción; las transferencias vault → estrategia no necesitan la auth del escrow.
- **withdraw_all:** `withdraw(shares, [0], escrow)` con `min_amounts_out = 0` **a propósito**: una pérdida no debe bloquear la salida. Se mide por diferencia de balance del token y lo absorbe `split()`. Antes de pagar siempre se retira.
- **preview_value:** `try_get_asset_amounts_per_shares(shares)[0]`; si falla, 0 (CT-10).
- **Contrato del mock (P2):** `__constructor(admin, asset)`; las mismas 6 firmas (`get_fees` configurable con `set_fees(vf, pf)` para probar `VaultFeeChanged`; `get_manager` devuelve `admin`) (`deposit` puede devolver `(Vec<i128>, i128)`, porque el escrow ignora el retorno); token de shares SEP-41 mínimo (`balance`, `total_supply`); `set_rate_bps(i32)` anualizado, lineal y con negativos posibles, solo admin; `InsufficientReserve` si no puede pagar. Debe **tirar con `transfer_from`-equivalente exactamente `token.transfer(from, mock, amount)`**, como DeFindex, para que el árbol de auth sea idéntico.
- **`evil_vault` en tests (P1):** tira de más, mintea shares falsas o paga menos, para probar CT-8.

## 6. `deployments/testnet.json` (P2)
```json
{
  "network": "testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "startLedger": 0,
  "factory": "C…",
  "escrowWasmHash": "…",
  "escrowWasmHashesAllowed": ["…"],
  "token": "C…", "tokenCode": "USDC", "tokenIssuer": "G…",
  "strategies": [
    { "id": "usdc_fixed", "kind": "defindex", "vault": "C… (usdc_paltalabs_vault u otro tras el spike)", "defindexStrategy": "CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY (USDC_blend_strategy, a confirmar)", "apyPool": "C… (pool Blend testnet)", "assetName": "USDC:G…", "risk": "standard", "simulated": false, "default": true, "maxVaultFeeBps": 1000 },
    { "id": "usdc_mock", "kind": "defindex", "vault": "C… (mock-vault)", "risk": "standard", "simulated": true,  "default": false },
    { "id": "custody",   "kind": "noyield",  "vault": null, "risk": "noyield", "simulated": false, "default": false }
  ],
  "defindex": { "factory": "CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32", "vaultWasmHash": "f345228d…" },
  "admin": "G…", "staff": ["G…"], "treasury": "G…", "twFeeBps": 0, "twFeeReceiver": null,
  "faucet": "G…", "readSource": "G…",
  "relayer": "https://channels.openzeppelin.com/testnet",
  "smartAccount": { "accountWasmHash": "…", "webauthnVerifier": "C… | null" },
  "anchor": { "mode": "simulated | sep24", "homeDomain": "testanchor.stellar.org" },
  "demo": { "longFianzaId": 0 },
  "updatedAt": "2026-…"
}
```
`strategies` es un **espejo** de `factory.strategies()` para el front y el Relayer. Si no coinciden, manda la cadena. `escrowWasmHashesAllowed` alimenta la política del Relayer y WEB-3.

## 7. Paquetes TS: cambios respecto a la versión anterior

- **§ 10 `packages/wallet`:** la interfaz `Wallet`, `WalletError`, `SignPhase`, `createWallet` y `FakeWallet` no cambian. Se mantienen los añadidos de security: `AUTH_MISMATCH`, `signatureExpirationLedger ≤ latest + 60` y `location.hostname === rpId`. **WEB-3** espera estas subinvocaciones:
  - `factory.create_fianza`: ninguna.
  - `escrow.fund_escrow`: solo `token.transfer(tenant, escrow, terms.amount)`.
  - `escrow.stop`: solo `token.transfer(landlord, escrow, terms.stop_bond)`.
  - El resto: ninguna.
  - La raíz debe ser `deployments.factory`, o un escrow con `factory.id_of(addr)` válido.
- **§ 10 `Wallet`** += `signAndSendBuilt(res: UnsignedTransactionResponse, opts?: { onPhase }) => Promise<{ hash }>`: con `res.soroban` firma las auth entries con la passkey y envía a `/api/fianzas/v1/relay`; sin él (cuenta G) firma el XDR y llama a `/api/stellar/send-transaction` (§ 8.4). `WalletConfig.relayPath = "/api/fianzas/v1/relay"`.
- **§ 10 `@fianzas/wallet/server`:** nueva `RelayPolicy` (arquitectura § 8.2, con los topes de security N-3). La monta `apps/api` (P2) en `/fianzas/v1/relay`, no `apps/web`.
- **§ 11 (anchor y ramp simulado):** sin cambios de interfaz; se añaden las restricciones del ramp simulado.
- **§ 12 Presets:** `tenant_yield_bps` por **preset de país**. Los presets se quedan en el front y no afirman la ley.

## 8. API propia compatible con la Core API v2 de Trustless Work (P2) [AD-19]

**Objetivo.** Ofrecer la API de TW v2 para nuestro fork, de modo que `@trustless-work/escrow-js`, el React SDK y Blocks funcionen **cambiando solo la `baseUrl`** en todo lo que nuestro contrato hace igual que el de TW, y añadir endpoints propios para la factory, DeFindex y las reglas de la fianza. La API de TW no sirve, porque solo construye transacciones para su propia revisión del contrato. Rutas y payloads verificados el 25-oct-2026 en `docs.trustlesswork.com/trustless-work/v2-en/api-rest/*` (base de testnet de TW: `https://beta.api.trustlesswork.com`).

**Base URL:** `https://<dominio>/api` (la misma origin que `apps/web`, § 8.6). En el SDK: `baseURL = "https://<dominio>/api"`.

**Convenciones copiadas de TW** (no se negocian):
1. **La API nunca firma.** `BUILD POST /escrow/<family>/<version>/<action>` → `{ unsignedXdr, txHash, contractId? }`; el cliente firma; `SUBMIT POST /stellar/send-transaction { signedXdr }`.
2. El escrow se identifica por su `contractId` (`C…`); el id numérico de la fianza solo aparece en `/fianzas/v1`.
3. Todo en camelCase.
4. Paginación keyset `{ data, hasMore, nextCursor }`, nunca un array suelto. `nextCursor` es opaco (base64url de `{start}` sobre los índices de la factory).
5. Errores RFC 9457 Problem Details `{ type, title, status, code, detail, instance, traceId, extensions }`. Se reutilizan los códigos de TW cuando el concepto coincide (`ESCROW_NOT_FOUND`, `ESCROW_ALREADY_RESOLVED`, `ESCROW_APPROVER_ALREADY_APPROVED_MILESTONE`, `ESCROW_UNAUTHORIZED_APPROVER`, `ESCROW_ONLY_DISPUTE_RESOLVER_CAN_EXECUTE`, `ESCROW_PROPERTIES_MISMATCH` para `TermsMismatch`, `ESCROW_NOT_COMPLETED`, `STELLAR_SIMULATION_FAILED`, `STELLAR_STATE_ARCHIVED` con `extensions.restoreXdr`, `AMOUNT_PRECISION_UNSUPPORTED`, `TOO_MANY_REQUESTS`). Los conceptos propios usan `FZ_<NOMBRE>` (`FZ_DEADLINE_PASSED`, `FZ_INSUFFICIENT_BOND`, `FZ_VAULT_FEE_CHANGED`, `FZ_INVALID_INVITE`, `FZ_ENDPOINT_NOT_SUPPORTED`…). Siempre va `extensions.contractError: number` si el error viene del contrato.
6. Importes: en las **lecturas**, strings decimales (`"150.0000000"`). En las **escrituras** se acepta `number` (como TW: "10 = 10 USDC") o string decimal; más de 7 decimales → `AMOUNT_PRECISION_UNSUPPORTED`. Los bps se exponen como bps (`platformFeeBps`) en `/fianzas/v1`; en la forma TW, `platformFee` es un porcentaje (ver 6.8.2).
7. El read-model es eventualmente consistente; **la cadena manda**.

**Respuesta de build** (`UnsignedTransactionResponse` de TW + una extensión):
```ts
interface UnsignedTransactionResponse {
  unsignedXdr: string;        // tx preparada (simulada). Firmable tal cual si signer es una cuenta G
  txHash: string;             // hash de la tx preparada (solo coincide si se firma tal cual)
  contractId?: string | null; // en creaciones: dirección que TENDRÁ el escrow (predict_address)
  soroban?: {                 // [EXT] solo si signer es una C-address (passkey)
    func: string;             // base64 XDR HostFunction
    auth: string[];           // base64 SorobanAuthorizationEntry SIN firmar, para el smart account
    validUntilLedger: number; // = latestLedger + 60 (AUTH-5)
  };
}
```

### 6.8.1 Endpoints de TW Single-Release v2: qué se implementa

Regla de decisión para los que cambian de semántica: **se conserva la ruta de TW solo si su cuerpo basta para construir nuestra llamada sin adivinar nada, y si el efecto es igual o más restrictivo que lo que espera un usuario del SDK de TW.** Si no, la operación va a una **ruta nueva** en `/fianzas/v1` y la ruta de TW responde `501 FZ_ENDPOINT_NOT_SUPPORTED` con `extensions.replacement` (la ruta nueva). Motivo: un hook del SDK (por ejemplo, el de resolver una disputa con `distributions`) que se reinterpretara en silencio movería el dinero de otra forma de la que el integrador cree. Es mejor fallar de forma explícita que acertar a medias. Por la misma razón, **no** se extiende el cuerpo de una ruta de TW con campos que cambian el efecto económico.

| TW v2 (método y ruta) | Cuerpo TW | Nuestro comportamiento | Categoría | Función del contrato |
|---|---|---|---|---|
| `POST /escrow/single-release/v2/deploy` | `signer, engagementId, title, description, roles, amount, platformFee, milestones?, trustline` | Roles, fees y token no los elige el llamante: salen de la configuración de la factory → **501**, reemplazo `POST /fianzas/v1/fianzas` | No implementado (ruta nueva) | — |
| `POST /escrow/single-release/v2/fund` | `contractId, signer, amount` | **Misma ruta y forma.** `signer` = inquilino; `amount` debe ser igual a `terms.amount` (si no, 422 `ESCROW_PROPERTIES_MISMATCH`); el servidor lee `get_terms()` y lo pasa como `expected_terms`. **[EXT] opcional** `inviteCode` (base64url de 32 B) para fianzas con invitación. Sin `inviteCode` solo vale si la fianza tiene el inquilino fijado | Igual + campo opcional | `fund_escrow` |
| `POST /escrow/single-release/v2/approve-milestones` | `contractId, approver, milestoneIndexes` | **Misma ruta y forma.** `milestoneIndexes` debe ser `[0]` (si no, 422 `ESCROW_INVALID_MILESTONE_INDEX`). **Diferencia:** la aprobación que completa el quórum **liquida** en la misma transacción, porque los dos approvers son también release signers. El SDK no tiene que hacer nada más | Igual, con efecto adicional documentado | `approve_release` |
| `POST /escrow/single-release/v2/approve-and-release-milestones` | `contractId, signer, milestoneIndexes` | **Misma ruta y forma.** Se simula antes: si tras esta aprobación no se alcanza el quórum, 422 `ESCROW_NOT_COMPLETED`, como en TW | Igual | `approve_release` |
| `POST /escrow/single-release/v2/release-funds` | `contractId, releaseSigner` | No hay liberación separada (la hace la 2.ª aprobación) → **501**, reemplazo `approve-and-release-milestones` | No implementado | — |
| `POST /escrow/single-release/v2/change-milestone-status` | `contractId, serviceProvider, updates` | No hay estados de milestone → **501** | No implementado | — |
| `POST /escrow/single-release/v2/dispute` | `contractId, signer, reason` | Solo el casero puede parar, mueve un **bond** y el motivo va como **hash con sal** (no texto on-chain) → **501**, reemplazo `POST /fianzas/v1/fianzas/{contractId}/stop` | Cambia de semántica → ruta nueva | `stop` |
| `POST /escrow/single-release/v2/resolve-dispute` | `contractId, disputeResolver, distributions[]` | El reparto libre no existe; se resuelve con `deduction` + `stopJustified` → **501**, reemplazo `POST /fianzas/v1/fianzas/{contractId}/resolve` | Cambia de semántica → ruta nueva | `resolve` |
| `POST /escrow/single-release/v2/withdraw-remaining-funds` | `contractId, disputeResolver, distributions[]` | Eliminado en el fork → **501** | No implementado | — |
| `PUT /escrow/single-release/v2/update` | `contractId, admin, escrow` | `Terms` inmutables → **501** | No implementado | — |
| `POST /escrow/single-release/v2/manage-milestones` | `contractId, admin, newMilestones, milestoneUpdates` | Sin milestones editables → **501** | No implementado | — |
| `POST /escrow/single-release/v2/extend-ttl` | `contractId, admin, ledgersToExtend` | **Misma ruta y forma.** En el fork es sin permisos: `admin` se usa solo como cuenta que firma y paga; `ledgersToExtend` se ignora (se extiende al máximo). Si está archivado: 409 `STELLAR_STATE_ARCHIVED` con `restoreXdr`, como en TW | Igual (más permisivo) | `extend_contract_ttl` |
| `POST /stellar/send-transaction` | `signedXdr` | **Misma ruta y forma.** Envío normal a la RPC de Soroban (la cuenta origen paga). Respuesta `{ txHash, ledger, contractId?, code: "STELLAR_TX_SUBMITTED" }`. **No patrocina** (6.8.4) | Igual | — |
| `GET /escrow/single-release/v2/{contractId}` | — | **Misma ruta.** Lectura directa (`get_escrow`) devuelta **en la forma TW v2** (tabla 6.8.2) + `fianza` [EXT] con `Terms`, estado efectivo, bond, liquidación y comisiones | Igual + extensión | `get_escrow`, `get_roles` |
| `GET /escrow/single-release/v2/escrow-balances?addresses=` (≤ 20) | — | **Misma ruta.** `balance` = valor estimado del principal en el vault (`preview_value`) + saldo líquido (bond o principal `NoYield`); `trustlineDecimals = 7` | Igual (valor, no saldo bruto, documentado) | `get_view` |
| `GET /escrows` | `scope, limit, cursor, includeSnapshot, sort, order, createdAfter, createdBefore, status, type, contractVersion, engagementId, contractIds, participant, role, platformId, subjectId` | **Misma ruta.** Se soportan `limit` (1–200), `cursor`, `includeSnapshot`, `order`, `status`, `contractIds` (1–50), `participant` + `role` (`approver`/`serviceProvider` = casero o inquilino; `receiver` = inquilino; `platform` = tesorería) y `engagementId` (`fianza-<id>`). `sort` solo `createdAt` (= orden de id). `platformId`, `subjectId`, `createdAfter/Before` → 400 `VALIDATION_ERROR` (no se ignoran en silencio). `scope=mine` exige API key; sin auth vale `scope=all` (datos públicos on-chain). `contractVersion` = `"v2-fianzas"` | Igual (subconjunto) | `factory.list_by_*`, `get_fianzas` |
| `GET /escrows/{contractId}` | — | **Misma ruta.** Fila del read-model + `snapshot` (forma TW) | Igual | `get_escrow` |
| `GET /escrows/details?contractIds=` (≤ 50) | — | **Misma ruta.** En lotes de 25 sobre `get_fianzas` | Igual | `get_fianzas` |
| `GET /escrows/{contractId}/events` | `limit, cursor, order` | **Misma ruta.** Eventos `fz_*` de ese contrato (RPC `getEvents`, límite de retención de la RPC: ver 6.8.5) | Igual | — |
| `GET /escrows/{contractId}/milestones`, `GET /escrows/milestones` | — | Un único milestone sintético "Devolución de la fianza" | Igual | `get_escrow` |
| `GET /escrows/financial?contractIds=` (≤ 50) | — | **Misma ruta.** Principal, rendimiento acumulado estimado, comisiones (todas, § 9) y, si está liquidada, el `Settlement` | Igual + campos | `get_view` |
| `POST /graphql` | — | **501** en el MVP | No implementado | — |
| Auth de TW (API keys, sesiones de wallet, Subjects, Platforms) | — | Solo `x-api-key` (6.8.7). El resto → 501 | Parcial | — |

**Resumen:** 13 rutas de TW se sirven igual o con extensiones (`fund`, `approve-milestones`, `approve-and-release-milestones`, `extend-ttl`, `send-transaction` y 8 lecturas). Dos cambian de semántica y van a ruta nueva (`dispute` → `stop`, `resolve-dispute` → `resolve`). Siete no se implementan (`deploy` → ruta nueva de la factory, `release-funds`, `change-milestone-status`, `withdraw-remaining-funds`, `update`, `manage-milestones`, `graphql`).

### 6.8.2 Forma TW v2 del escrow (`snapshot`)
| Campo TW | Valor en el fork | Nota |
|---|---|---|
| `engagementId` | `"fianza-<id>"` | |
| `title` / `description` | `"Fianza #<id>"` / `""` | Sin datos personales on-chain (DAT-1) |
| `roles` | `get_roles()` en camelCase; `receiver` = `null` hasta el fondeo | 6.1 |
| `amount` | principal (string decimal) | |
| `platformFee` | **`0`** | En TW es un % del **bruto**; el nuestro es del **rendimiento**. Exponer el 20 % en este campo haría que un componente de Blocks mostrara "20 % de la fianza", así que el valor real va en `fianza.fees` (Q-26) |
| `milestones` | `[{ description: "Devolución de la fianza", status: <estado efectivo en snake_case>, evidence: "", approvals: { target: 2, approvalCount, approvedBy } }]` | |
| `dispute` | `{ isDisputed: status ∈ {Stopped, UnderReview}, reason: "", resolved: path ∈ {Resolved, ReviewTimeout} }` | El motivo solo existe como hash: `fianza.reasonHash` |
| `released` | `path ∈ {Approved, Timeout}` | |
| `trustline` | `{ address: token }` | |
| **`fianza`** [EXT] | `{ id, status, terms, fees, stopBond, bondHeld, stopJustified, tenantYieldBps, timeoutAt, reviewDeadline, accruedYield, settlement, path, strategy }` | La fuente completa |

### 6.8.3 Endpoints nuevos (`/fianzas/v1`)
Mismo bucle build → sign → submit, la misma `UnsignedTransactionResponse` y los mismos errores.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/fianzas/v1/fianzas` | Build de `factory.create_fianza`. Devuelve `contractId` (predicho con `predict_address(landlord, nonce)`, estable) y `id: null` (se conoce al ejecutarse, en `send-transaction` y en el evento) |
| POST | `/fianzas/v1/fianzas/batch` **[Could]** | Build de `create_fianzas_batch` (≤ `MAX_BATCH`) |
| GET | `/fianzas/v1/config` | `GlobalConfig` de la factory, `paused`, `escrowWasmHash` y `MAX_*` |
| GET | `/fianzas/v1/strategies` | Registro de la factory **+ datos en vivo**: `supplyApy` del pool de Blend (`apy_pool`, SDK de Blend), `vaultFeeBps`/`protocolFeeBps` actuales (`get_fees()`), `maxVaultFeeBps`, `risk`, `simulated`, `enabled`, `isDefault`, `apyLabel: "~6-7 %, variable"` (o "variable" si no hay dato) y `updatedAt`. Caché de 60 s |
| GET | `/fianzas/v1/fianzas/by-id/{id}` | `{ id, contractId }` (`escrow_of`); lo usa la página de invitación |
| GET | `/fianzas/v1/fianzas/{contractId}/terms` | `Terms` completos con **todas las comisiones fijadas**: `platformFeeBps`, `twFeeBps`, `defindexVaultFeeBps`, `defindexProtocolFeeBps` (base de cada una), `stopBond`, plazos y estrategia |
| GET | `/fianzas/v1/fianzas/{contractId}/view` | `EscrowView`: estado efectivo, `timeoutAt`, `reviewDeadline` y `accruedYield` |
| GET | `/fianzas/v1/fianzas/{contractId}/yield` | `{ accruedYield, estimatedToTenant, estimatedToLandlord, estimatedToTreasury, estimatedToTw, asOf }` (`preview_settlement(0)`; estimación, no garantizada) |
| GET | `/fianzas/v1/fianzas/{contractId}/preview-settlement?deduction=` | `Settlement` de `preview_settlement(deduction)` (backoffice) |
| POST | `/fianzas/v1/fianzas/{contractId}/cancel` | Build de `cancel` |
| POST | `/fianzas/v1/fianzas/{contractId}/stop` | Build de `stop(reasonHash)`, con el bond anidado en el árbol de auth. La respuesta añade `stopBond` para que la UI lo muestre antes de firmar |
| POST | `/fianzas/v1/fianzas/{contractId}/assign-expert` | Build de `assign_expert` |
| POST | `/fianzas/v1/fianzas/{contractId}/record-report` | Build de `record_report` |
| POST | `/fianzas/v1/fianzas/{contractId}/resolve` | Build de `resolve(deduction, stopJustified)`. Rechaza `stopJustified = false` con `deduction > 0` antes de simular (`FZ_INCOHERENT_RESOLUTION`) |
| POST | `/fianzas/v1/fianzas/{contractId}/claim-timeout` | Build de `claim_after_timeout` (sin permisos; `signer` solo paga o patrocina) |
| POST | `/fianzas/v1/fianzas/{contractId}/claim-review-timeout` | Build de `claim_after_review_timeout` |
| GET | `/fianzas/v1/landlords/{address}/fianzas?cursor&limit&status` | `factory.list_by_landlord` + `get_fianzas` → `{ data: FianzaSummary[], hasMore, nextCursor }` |
| GET | `/fianzas/v1/tenants/{address}/fianzas?cursor&limit&status` | Igual con `list_by_tenant` |
| GET | `/fianzas/v1/strategies/{id}/price` | Precio por share del vault (`get_asset_amounts_per_shares(10^7)`) para estimar el rendimiento de una lista sin N simulaciones (§ 8.3) |
| POST | `/fianzas/v1/relay` | Envío **patrocinado** para C-addresses: `createRelayHandler(RelayPolicy)` de `@fianzas/wallet/server` (6.8.4) |
| POST / GET | `/fianzas/v1/ramp` | Ramp simulado: `createSimRampHandler` de `@fianzas/anchor/server` (sin cambios de comportamiento) |
| GET | `/openapi.json` **[Could]** | Spec OpenAPI generada |

Los endpoints de admin de la factory (`set_config`, `add_strategy`, `set_escrow_wasm_hash`, `pause`…) **no** se exponen en la API: se operan con `scripts/` e identidades del CLI.

### 6.8.4 Envío y Relayer: **endpoint aparte** [AD-20]
- **`POST /stellar/send-transaction`** se mantiene con la semántica de TW: la cuenta origen (G) firma la transacción y **paga su fee** (staff con Freighter, caseros con wallet clásica, integradores con API key). El servidor solo valida que sea un XDR firmado y lo envía a la RPC.
- **`POST /fianzas/v1/relay { func, auth }`** es el **único** camino patrocinado, para las C-address con passkey: es `createRelayHandler` con la `RelayPolicy` de § 8.2 (contratos y funciones permitidos, wasm hash y registro en la factory, sin `SOURCE_ACCOUNT`, raíz idéntica a `func`, límites de tamaño y ritmo y `Origin` propio).
- **Por qué no decide `send-transaction`:** si inspeccionara el XDR para "decidir" si patrocina, cualquier transacción de una cuenta G que tocara un contrato permitido podría conseguir el patrocinio. Además, la decisión quedaría implícita y repartida entre dos rutas, y el contrato de TW de esa ruta ("pagas tú") se rompería. Con un endpoint aparte, la superficie de la política es una sola, y el test de AC-11 y SRV-* se queda igual.
- **Flujo con passkey:** build (`signer` = C…) → respuesta con `soroban.func` + `soroban.auth` → `packages/wallet` firma las auth entries con la passkey (verificando WEB-3) → `POST /fianzas/v1/relay`. El `unsignedXdr` en ese caso se construye con `readSource` como origen, es solo informativo y no se puede enviar.
- **`packages/wallet`** añade `signAndSendBuilt(res: UnsignedTransactionResponse, opts?)` junto a `signAndSend(tx: AssembledTransaction)` (§ 6.7). Si recibe `soroban`, va por el Relayer; si no, firma el XDR (solo cuentas G y Freighter) y llama a `send-transaction`.
- La API key de Channels (`RELAYER_API_KEY`) vive **solo** en el servidor de la API (SRV-1).

### 6.8.5 Read-model: **lectura directa de la cadena + caché en memoria** (sin indexer propio en el MVP) [AD-21]
- **Listas:** índices on-chain de la factory (`list_by_landlord`/`list_by_tenant` y `count`), así que no hace falta indexer para listar.
- **Detalle y lotes:** simulación de `get_escrow`/`get_fianzas` (≤ 25 por simulación).
- **Rendimiento:** precio por share por vault, una vez por petición.
- **Eventos:** `getEvents` de la RPC bajo demanda, filtrando por `contractId` y desde `deployments.startLedger`. **Límite:** la RPC pública solo guarda eventos durante una ventana limitada (del orden de días); en la demo basta. Fuera de la ventana, `GET /escrows/{contractId}/events` devuelve los que haya y `extensions.truncated = true`.
- **Caché** en memoria por instancia (TTL de 5 s en lecturas de estado, 60 s en estrategias y APY) y deduplicación de peticiones simultáneas.
- **Por qué no un indexer en 28 h:** un proceso que consuma `getEvents` y escriba en una base de datos exige persistencia, despliegue aparte y reconciliación. La cadena ya ofrece índices por casero e inquilino porque la factory los guarda. **Mainnet [M]:** indexer de eventos `fz_*`/`f_*` → Postgres, con `getEvents` en continuo y reconciliación con `get_escrow`, sin cambiar el contrato HTTP.

### 6.8.6 Stack y despliegue
- **Hono 4** (Request/Response estándar) + `zod` (`@hono/zod-validator`) + `@stellar/stellar-sdk` (RPC y XDR) + `packages/bindings` + `@blend-capital/blend-sdk` (APY) + una librería decimal (`decimal.js`).
- Paquete `apps/api` → `@fianzas/api`, que exporta `createApp(cfg)` y el cliente tipado `@fianzas/api/client` (fetch fino + tipos) para `apps/web` y `apps/backoffice`.
- **Despliegue: dentro de `apps/web`** con una única ruta catch-all, `apps/web/app/api/[[...path]]/route.ts`, que exporta `GET`/`POST`/`PUT` = `handle(createApp(cfg))` de `hono/vercel`. Así hay **una origin** (sin CORS para nuestro front, y CS-3 sigue valiendo), un solo despliegue en Vercel y los secretos solo en el entorno Production (SEC-4).
- Las rutas antiguas `apps/web/app/api/relay` y `/api/ramp` **se eliminan**: `WalletConfig.relayPath = "/api/fianzas/v1/relay"` y `rampPath = "/api/fianzas/v1/ramp"`.
- Desarrollo local: `pnpm --filter @fianzas/api dev` con `@hono/node-server` (puerto 8787).
- CORS solo para orígenes registrados por API key.
- **Configuración:** `@fianzas/deployments` (direcciones) más `RELAYER_URL`, `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET`, `RAMP_ENABLED`, `SOROBAN_RPC_URL`, `NETWORK_PASSPHRASE`, `API_KEYS_JSON` y `BLEND_POOL_RPC` (opcional). Ninguna lleva el prefijo `NEXT_PUBLIC_`.

### 6.8.7 Autenticación y límites
| Credencial | Para quién | Qué permite | Límite |
|---|---|---|---|
| **Ninguna** (misma origin) | Nuestro front | Lecturas, builds, `/fianzas/v1/relay` y `/fianzas/v1/ramp` (con comprobación de `Origin`) | Lecturas: 120/min por IP. Builds: 30/min por IP. Relay: SRV-6. Ramp: SRV-12 |
| **`x-api-key: <id>.<secret>`** (formato de TW) | Grandes caseros e integradores (SDK de TW) | Lecturas (`scope=mine` = las direcciones de casero registradas en la key), builds y `send-transaction` | 300/min por key. **Nunca** el Relayer: los integradores pagan su fee |
| `Authorization: Bearer <jwt>` (sesión de wallet de TW) | — | **No en el MVP** → 401 `AUTH_SESSION_NOT_CONFIGURED` (código de TW). [M]: SEP-10 (G) / SEP-45 (C) | — |

- Las keys viven en `API_KEYS_JSON` (sin base de datos): `[{ id, secretSha256, label, landlords: ["G…|C…"], scopes: ["read","build","submit"], rpm, origins? }]`. El secreto se compara en tiempo constante sobre `sha256(secret)`. Las keys las da P2 a mano.
- **Los builds no requieren auth**, porque solo producen datos sin firmar: la cadena aplica `require_auth`. Lo que se protege es el coste (simulaciones de la RPC y Channels).
- **`inviteCode` en `fund`:** viaja por HTTPS a nuestra misma origin; el servidor **no** lo registra ni lo cachea (DAT-6) y lo descarta tras simular. Riesgo residual: el operador de la API lo ve antes del envío (R-18).
- Límites en memoria por instancia (limitación aceptada; [M] KV compartido).

### 6.8.8 Dueño y carpeta: **`apps/api/` → P2** [AD-22]
- **Por qué P2:** es el integrador y ya es dueño de los bindings, `deployments` y scripts, que son la base de la API. Al quedar fuera `yield-adapter` tiene unas 4 h libres. P1 es el rol más cargado y P3 y P4 tienen la ruta crítica de passkeys y UI.
- **P3** sigue siendo dueño de `createRelayHandler` y `createSimRampHandler` (en sus paquetes); la API solo los monta.
- **P4** solo añade el archivo catch-all de `apps/web` y consume `@fianzas/api/client`.
- **`harness/team.json`** (PR de P2 con `/lock harness`, junto al de § 4.1): `{ "id": "api", "owner": "P2", "paths": ["apps/api/**"], "scopes": ["api"] }`, añadido antes de `"web"`. En `CLAUDE.md`: fila de P2 += `apps/api/` y lista de scopes += `api`. Ejemplo de commit: `feat(api): añadir build de fund compatible con TW v2`.

### 6.8.9 Tabla para `docs/INTERFACES.md` (§ 7 nuevo: API)
Auth: **A** = anónima de la misma origin; **K** = `x-api-key`; **A/K** = cualquiera de las dos. Las respuestas de build son `UnsignedTransactionResponse` (UTR).

| Método | Ruta | Auth | Body / query | Respuesta | Firma el XDR | Función |
|---|---|---|---|---|---|---|
| POST | `/escrow/single-release/v2/fund` | A/K | `{ contractId, signer, amount, inviteCode? }` | UTR | inquilino | `escrow.fund_escrow` |
| POST | `/escrow/single-release/v2/approve-milestones` | A/K | `{ contractId, approver, milestoneIndexes: [0] }` | UTR | casero o inquilino | `escrow.approve_release` |
| POST | `/escrow/single-release/v2/approve-and-release-milestones` | A/K | `{ contractId, signer, milestoneIndexes: [0] }` | UTR | casero o inquilino (la 2.ª firma) | `escrow.approve_release` |
| POST | `/escrow/single-release/v2/extend-ttl` | A/K | `{ contractId, admin, ledgersToExtend }` | UTR | cualquiera (paga) | `escrow.extend_contract_ttl` |
| POST | `/stellar/send-transaction` | A/K | `{ signedXdr }` | `{ txHash, ledger, contractId?, code }` | ya firmado (G) | — |
| GET | `/escrow/single-release/v2/{contractId}` | A/K | — | snapshot TW + `fianza` | — | `escrow.get_escrow` |
| GET | `/escrow/single-release/v2/escrow-balances` | A/K | `addresses` (≤ 20) | `[{ address, balance, trustlineDecimals }]` | — | `escrow.get_view` |
| GET | `/escrows` | A/K | `limit, cursor, includeSnapshot, order, status, contractIds, participant, role, engagementId, scope` | `{ data, hasMore, nextCursor }` | — | `factory.list_by_*` + `get_fianzas` |
| GET | `/escrows/{contractId}` · `/escrows/details` · `/escrows/{contractId}/events` · `/escrows/{contractId}/milestones` · `/escrows/milestones` · `/escrows/financial` | A/K | según TW | según TW (+ campos) | — | lecturas |
| POST | `/fianzas/v1/fianzas` | A/K | `{ signer, tenant?, inviteHash?, amount, endTs, tenantYieldBps, strategyId?, nonce }` | UTR (`contractId` predicho) | casero | `factory.create_fianza` |
| POST | `/fianzas/v1/fianzas/batch` [Could] | K | `{ signer, items: [...] }` | UTR | casero | `factory.create_fianzas_batch` |
| GET | `/fianzas/v1/config` | A/K | — | `GlobalConfig` + `paused` | — | `factory.config` |
| GET | `/fianzas/v1/strategies` | A/K | — | `[{ id, kind, vault, assetName, risk, simulated, enabled, isDefault, maxVaultFeeBps, vaultFeeBps, protocolFeeBps, supplyApy, apyLabel, updatedAt }]` | — | `factory.strategies` + `vault.get_fees` + Blend |
| GET | `/fianzas/v1/strategies/{id}/price` | A/K | — | `{ pricePerShare, asOf }` | — | `vault.get_asset_amounts_per_shares` |
| GET | `/fianzas/v1/fianzas/by-id/{id}` | A/K | — | `{ id, contractId }` | — | `factory.escrow_of` |
| GET | `/fianzas/v1/fianzas/{contractId}/terms` | A/K | — | `Terms` (con las 4 comisiones) | — | `escrow.get_terms` |
| GET | `/fianzas/v1/fianzas/{contractId}/view` | A/K | — | `EscrowView` | — | `escrow.get_view` |
| GET | `/fianzas/v1/fianzas/{contractId}/yield` | A/K | — | `{ accruedYield, estimatedTo*, asOf }` | — | `escrow.preview_settlement(0)` |
| GET | `/fianzas/v1/fianzas/{contractId}/preview-settlement` | A/K | `deduction` | `Settlement` | — | `escrow.preview_settlement` |
| POST | `/fianzas/v1/fianzas/{contractId}/cancel` | A/K | `{ signer }` | UTR | casero | `escrow.cancel` |
| POST | `/fianzas/v1/fianzas/{contractId}/stop` | A/K | `{ signer, reasonHash }` | UTR + `stopBond` | casero | `escrow.stop` |
| POST | `/fianzas/v1/fianzas/{contractId}/assign-expert` | A/K | `{ resolver, expertRef }` | UTR | staff (Freighter) | `escrow.assign_expert` |
| POST | `/fianzas/v1/fianzas/{contractId}/record-report` | A/K | `{ resolver, reportHash }` | UTR | staff | `escrow.record_report` |
| POST | `/fianzas/v1/fianzas/{contractId}/resolve` | A/K | `{ resolver, deduction, stopJustified }` | UTR | staff | `escrow.resolve` |
| POST | `/fianzas/v1/fianzas/{contractId}/claim-timeout` | A/K | `{ signer }` | UTR | cualquiera | `escrow.claim_after_timeout` |
| POST | `/fianzas/v1/fianzas/{contractId}/claim-review-timeout` | A/K | `{ signer }` | UTR | cualquiera | `escrow.claim_after_review_timeout` |
| GET | `/fianzas/v1/landlords/{address}/fianzas` | A/K | `cursor, limit, status` | `{ data: FianzaSummary[], hasMore, nextCursor }` | — | `factory.list_by_landlord` + `get_fianzas` |
| GET | `/fianzas/v1/tenants/{address}/fianzas` | A/K | `cursor, limit, status` | igual | — | `factory.list_by_tenant` + `get_fianzas` |
| POST | `/fianzas/v1/relay` | A (misma origin) | `{ func, auth[] }` | `{ hash, status }` / `{ code }` | auth entries con passkey; origen y fee: Relayer | la de `func` (lista blanca) |
| POST · GET | `/fianzas/v1/ramp` | A (misma origin) | `{ to, amount }` · `?id=` | `{ id, hash }` · `{ status }` | faucet (servidor) | `token.transfer` |
| POST/PUT | `deploy`, `release-funds`, `change-milestone-status`, `dispute`, `resolve-dispute`, `withdraw-remaining-funds`, `update`, `manage-milestones`, `/graphql` | — | — | `501 FZ_ENDPOINT_NOT_SUPPORTED` + `extensions.replacement` | — | — |

En el MVP, `/stop`, `/resolve`, `/assign-expert` y `/record-report` con `signer`/`resolver` G devuelven un XDR que el staff firma con Freighter y envía con `send-transaction`. Las funciones de staff **nunca** pasan por el Relayer.

## 9. Comisiones de DeFindex fijadas en los `Terms` [AD-23]

Verificado en `paltalabs/defindex/apps/contracts/vault/src/lib.rs`: el vault expone `get_fees(e) -> (u32, u32)` = `(vault_fee, defindex_protocol_fee)` en bps, cobradas **sobre las ganancias** mediante `report`/`lock_fees`. El manager del vault puede cambiar la comisión (`lock_fees(new_fee_bps)`) y su receptor (`set_fee_receiver`), y hay `get_manager()`.

**Qué se fija al activarse la fianza.** Cuando el inquilino fondea, las cuatro comisiones ya están en `Terms`, que él firma en `expected_terms`:

| Comisión | Campo | Base | Quién la cobra | Cuándo se fija |
|---|---|---|---|---|
| Plataforma | `platform_fee_bps` | rendimiento neto del vault | `split()` → tesorería | al crear (config) |
| Trustless Work | `tw_fee_bps` (**0 en el MVP**) | rendimiento neto del vault | `split()` → `tw_fee_receiver` | al crear (config) |
| DeFindex vault | `defindex_vault_fee_bps` | ganancias dentro del vault | **el vault** (reduce el valor de la share) | al crear (`get_fees()` desde la factory) y **comprobada al fondear** |
| DeFindex protocolo | `defindex_protocol_fee_bps` | según la semántica de DeFindex (a confirmar en el spike si se calcula sobre la comisión del vault o sobre las ganancias) | **el vault** | igual |

- **No hay doble descuento.** Las comisiones de DeFindex las cobra el vault dentro del rendimiento: `split()` recibe un `total` que ya es neto de ellas (medido por diferencia de balance al retirar). Por eso `split()` **no** las vuelve a restar. Se guardan en `Terms` para **mostrarlas** (pantalla de aceptación, `/terms`, `/escrows/financial`) y para el **reporting** (`fz_init`, `f_created` y `fz_settle.vault_fees_at_settle`).
- **Validación:**
  - Factory, `add_strategy`: `max_vault_fee_bps ≤ 2000`; `get_fees().0 ≤ max_vault_fee_bps`; si `config.vault_manager` está fijado, `get_manager() == vault_manager`.
  - Factory, `create_fianza`: `vf ≤ max_vault_fee_bps` y `pf ≤ 10000`, y copia de las dos en `Terms`.
  - Escrow, constructor: `platform_fee_bps + tw_fee_bps ≤ 10000` (son las únicas que resta `split()`). Además, `defindex_vault_fee_bps ≤ 10000`, `defindex_protocol_fee_bps ≤ 10000` y las dos a 0 si es `NoYield` (InvalidConfig).
  - No se exige que la suma de las cuatro sea ≤ 10000: se aplican en cascada (el vault sobre las ganancias brutas y las nuestras sobre lo que queda), así que la comisión efectiva total es `v + (1 − v)·(p + t) ≤ 100 %` siempre que cada parte lo sea.

**Riesgo: que el manager del vault suba la comisión después de crear la fianza.** Las tres opciones analizadas:

| Opción | Protege | No protege | Coste |
|---|---|---|---|
| (a) Solo vaults cuyo manager es la plataforma (vault propio creado con la factory de DeFindex) | Que un tercero suba la comisión en cualquier momento | Que la plataforma misma la suba (es un compromiso de gobernanza) | No disponible en testnet si se usa `usdc_paltalabs_vault` |
| (b) Tope `max_vault_fee_bps` en el registro, comprobado al crear | Que se den de alta fianzas con comisiones abusivas | Subidas posteriores | Una lectura |
| (c) `get_fees()` en `fund_escrow` y rechazo si supera el snapshot | Subidas entre crear y fondear: el inquilino nunca mete dinero con condiciones peores de las que firmó | Subidas **después** del fondeo | Una llamada cruzada más, **solo en la entrada** |

**Decisión: (b) + (c) siempre, y (a) obligatoria en mainnet.**
- (b) y (c) son baratas, se comprueban on-chain y cubren todo el tramo antes de que entre el dinero. Si falla (c), el error es `VaultFeeChanged`, el casero ve el aviso y puede cancelar y crear otra fianza.
- (a) es la única que limita el riesgo **después** del fondeo, y se puede exigir on-chain: con `config.vault_manager = Some(multisig)`, `add_strategy` rechaza vaults cuyo `get_manager()` sea otro (VaultNotPlatformManaged). En testnet `vault_manager = None` para poder usar `usdc_paltalabs_vault`, y la UI lo indica ("vault de terceros").
- **No se bloquea nunca una salida por comisiones:** `settle` no compara comisiones, solo las registra (`vault_fees_at_settle`). Tras el fondeo, una subida reduce el rendimiento, pero nunca el principal (la comisión de DeFindex solo se aplica a ganancias) ni la capacidad de liquidar.
- [M] Política de gobernanza del multisig: no subir `vault_fee` de un vault con fianzas activas, o hacerlo con un preaviso y un timelock publicados. Monitor de `get_fees()` que avise si cambia.

## 10. `packages/wallet` (P3)
```ts
export interface Wallet {
  createAccount(displayName: string): Promise<{ address: string }>; // passkey nueva → C-address
  connect(): Promise<{ address: string } | null>;                    // reconexión silenciosa
  signAndSend(tx: AssembledTransaction<unknown>): Promise<{ hash: string }>; // fees vía Relayer
  disconnect(): Promise<void>;
}
```

```ts
export type WalletErrorCode =        // lista mínima; P3 la cierra en G1. P4 traduce cada código
  | "USER_CANCELLED"      // el usuario cerró el diálogo de la passkey
  | "WRONG_ORIGIN"        // location.hostname !== cfg.rpId (AUTH-6)
  | "SIMULATION_FAILED"   // la simulación devolvió un error del contrato (lleva contractError)
  | "AUTH_MISMATCH"       // el árbol de auth no es el esperado: no se firma (WEB-3)
  | "RELAYER_DOWN"        // /api/relay o Channels no responden
  | "RATE_LIMITED"        // 429 del handler
  | "TX_FAILED";          // la red rechazó la transacción

export class WalletError extends Error { code: WalletErrorCode; contractError?: number }
```

Reglas de `signAndSend` (security WEB-3 v2, AUTH-5):
- Antes de pedir la passkey decodifica las auth entries de la C-address. La raíz debe ser `deployments.factory` o un escrow con `factory.id_of(addr)` válido. Las subinvocaciones deben ser **exactamente** las del § 7. Si no, `AUTH_MISMATCH` y no se firma.
- `signatureExpirationLedger ≤ latestLedger + 60`.

**`@fianzas/wallet/server` (solo servidor, `import "server-only"`):**
```ts
export interface RelayPolicy {
  fixedContracts: Record<string, string[]>;   // { [factory]: ["create_fianza"] }. create_fianzas_batch NO pasa por el Relayer en la demo (N-3)
  escrow: {
    wasmHashes: string[];                     // deployments.escrowWasmHashesAllowed
    factory: string;                          // la instancia debe estar registrada aquí
    functions: string[];                      // ["cancel","fund_escrow","approve_release","stop","claim_after_timeout","claim_after_review_timeout"]
  };
  createContractWasmHashes: string[];         // solo smart accounts
  maxRequestsPerMinutePerIp: number;          // 30
  maxRequestsPerMinutePerCredential: number;  // 10
  maxCreateFianzaPerHourPerCredential: number; // 5 (N-3)
  globalHourlyCap: number;                    // tope por instancia, p. ej. 600
}
export function createRelayHandler(cfg: { policy: RelayPolicy; relayerUrl: string; apiKey: string; rpcUrl: string }): (req: Request) => Promise<Response>;
```
- Un escrow que no está en `fixedContracts` solo pasa si **las dos** comprobaciones dan bien: su ejecutable (`getLedgerEntries`) es un wasm de `escrow.wasmHashes` y `factory.id_of(addr)` devuelve un id. El resultado se cachea por dirección.
- Rechaza credenciales `SOURCE_ACCOUNT`, raíces que no coinciden byte a byte con `func`, más de 4 auth entries, cuerpos de más de 64 KB y `Origin` ajeno (SRV-3, SRV-4, IV-5, CS-3). `assign_expert`, `record_report`, `resolve` y las funciones de admin **nunca** pasan por el Relayer.
- Las respuestas solo llevan `{ code }` (SRV-8).

## 11. `packages/anchor` (P3)
```ts
export interface Anchor {
  startDeposit(address: string, assetCode: string): Promise<{ url: string; id: string }>;   // URL interactiva SEP-24
  startWithdraw(address: string, assetCode: string): Promise<{ url: string; id: string }>;
  status(id: string): Promise<"pending" | "completed" | "error">;
  isSimulated: boolean; // true en el plan B: la UI lo muestra
}
```

**Ramp simulado (`@fianzas/anchor/server`, plan B)** (security SRV-10…SRV-15):
- `createSimRampHandler` lanza una excepción al construirse con la *passphrase* de mainnet.
- Solo envía a C-address que sean smart accounts nuestros (ejecutable = `smartAccount.accountWasmHash`).
- `amount` validado con `^\d{1,6}(\.\d{1,7})?$` y convertido con `BigInt`. Topes por petición, por dirección, por IP y global por hora. Con `RAMP_ENABLED=0` responde `403`.
- La cuenta faucet es exclusiva (no es staff, admin, treasury ni deployer) y tiene saldo acotado.

## 12. Presets de política de yield (P4 en el front)
| Preset | `tenant_yield_bps` |
|---|---|
| Todo al inquilino | 10000 |
| 50/50 | 5000 |
| Todo al casero | 0 |
| Personalizado | 0–10000 |

Los presets **no** afirman qué dice la ley de cada país. La UI lo indica.
