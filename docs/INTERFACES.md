# Interfaces

**Estado: BORRADOR v2. Se congela en G1 (hora 2).** A partir de ahí, cualquier cambio necesita un issue "Cambio de interfaz" y la aprobación del dueño de cada área afectada. Editar este archivo requiere `/lock interfaces`.

Fuente: `.kiro/pipeline/architecture.md` § 6, con los ajustes de `.kiro/pipeline/security.md` § 13.6 ya aplicados. Si hay discrepancia, manda este archivo.

Resumen: cada fianza es un contrato **escrow propio** (escrito desde cero, sin código de Trustless Work) creado por **`FianzaFactory`**. Al fondear, el escrow deposita la fianza en un vault de **DeFindex** (por defecto, Blend Fixed Pool USDC) y, al liquidar, la retira y la reparte con `split()`.

Convenciones: importes `i128` en la unidad mínima del token (7 decimales) y porcentajes en bps (10000 = 100 %). Constantes: `MAX_AMOUNT = 10^15`, `MAX_TERM_SECS = 3 × 365 × 86400`, `MAX_BATCH = 10`, `MAX_PAGE = 50`, `MAX_VIEWS = 25`.

## 1. Roles de una fianza

| Rol | Valor | Cómo se fija | Qué puede hacer y qué recibe |
|---|---|---|---|
| Casero (`landlord`) | dirección del casero | `create_fianza` | `cancel`, `approve_release`, `stop` (con bond). Recibe la deducción, su parte del rendimiento y el bond si la parada estaba justificada |
| Inquilino (`tenant`) | dirección del inquilino | fijado al crear o por invitación en `fund_escrow` | `fund_escrow`, `approve_release`. Recibe principal − deducción + su parte del rendimiento |
| Aprobaciones | quórum de 2: casero e inquilino, sin orden | `Approvals { target: 2 }` en el constructor | La segunda aprobación liquida |
| Resolvers (`dispute_resolvers`) | `config.staff` (1–3 direcciones) | copia en `Terms` al crear | `assign_expert`, `record_report`, `resolve`. Cualquiera de ellos puede resolver; inmutable por fianza |
| Tesorería (`treasury`) | `config.treasury` | copia en `Terms` | Recibe el fee de plataforma (del rendimiento) y el bond perdido |
| Factory | contrato que despliega la fianza | constructor | **Sin poderes** sobre la fianza. El escrow solo la consulta al fondear (`funding_allowed`, `register_tenant`) |
| Cualquiera | — | — | `claim_after_timeout`, `claim_after_review_timeout`, `extend_contract_ttl` y lecturas |

**Vinculación del inquilino invitado** (se mantiene [AD-3] y FR-2):
1. El navegador del casero genera `code = getRandomValues(32 B)` e `invite_hash = sha256(code)`, y llama a `create_fianza(landlord, { tenant: None, invite_hash: Some(h), … })`.
2. Enlace: `https://<dominio>/i/<id>#c=<base64url(code)>`. El **`id`** se resuelve a la dirección del escrow con `factory.escrow_of(id)`, nunca desde la URL (WEB-2 y WEB-11).
3. El inquilino crea su passkey, lee `get_terms()`, ve las condiciones y la estrategia con su aviso de riesgo, y firma `fund_escrow(tenant, Some(code), expected_terms)`. Antes de pedir la passkey, el front comprueba que `terms.factory`, `terms.treasury`, `terms.dispute_resolvers`, `terms.strategy.vault` y `terms.platform_fee_bps` coinciden con `deployments/testnet.json`. Si no coinciden, no deja fondear (security WEB-14).
4. El escrow comprueba `sha256(code) == invite_hash`, fija `tenant` y llama a `factory.register_tenant(id, tenant)`, que comprueba que el llamante es `escrow_of(id)` y añade el id al índice del inquilino.
5. Si el casero conoce la dirección (`tenant: Some(t)`, `invite_hash: None`), `fund_escrow` exige `tenant == t`. Exactamente uno de los dos debe estar presente.

## 2. Contrato `escrow` (propio, P1)

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
    pub treasury: Address,
    pub dispute_resolvers: Vec<Address>,
    pub timeout_secs: u64,
    pub review_timeout_secs: u64,
    pub stop_bond: i128,          // min(max(min, amount·bps/10000), amount), calculado por la factory
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowInit { pub terms: Terms, pub tenant: Option<Address>, pub invite_hash: Option<BytesN<32>> }

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Approvals { pub target: u32, pub approval_count: u32, pub approved_by: Vec<Address> } // target = 2; sin duplicados

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
| `__constructor(init: EscrowInit)` | — (solo la despliega la factory; ver R-3) | `amount ∈ (0, MAX_AMOUNT]`; `end_ts > now`; bps válidos; exactamente uno de `tenant`/`invite_hash`; `dispute_resolvers` 1–3 sin duplicados. Si falla: `panic_with_error!` | — → `Proposed`. `approvals = {target: 2, count: 0, by: []}` |
| `cancel()` | `terms.landlord` | `Proposed` (BadStatus) | → `Cancelled` |
| `fund_escrow(tenant: Address, invite_code: Option<BytesN<32>>, expected_terms: Terms) -> i128` (shares) | `tenant` (+ `token.transfer(tenant, escrow, amount)` anidado) | `Proposed`; `now < end_ts` (InvalidEndTs); `expected_terms == terms` (TermsMismatch); invitación (InvalidInvite) o `tenant == fijado` (NotParty); `tenant ≠ landlord` (SameParty); partes (InvalidParty); `factory.funding_allowed(strategy.id)` (Paused); transferencia medida `== amount` (InvalidAmount); shares > 0 (VaultError). Las llamadas a la factory (`funding_allowed`, `register_tenant`) van con `try_`: si fallan, FactoryCall | `Proposed` → `Active` |
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
| `get_view() -> EscrowView` | — | llama al vault con `try_` | lectura |
| `accrued_yield() -> i128` | — | `max(preview − amount, 0)`; 0 si `NoYield`, sin fondos o con fallo | lectura |
| `preview_settlement(deduction: i128) -> Settlement` | — | estado con fondos; mismo `split()` | lectura |

**Superficie del contrato** (security N-2): el wasm del escrow exporta **exactamente** las funciones de esta tabla: ninguna de admin, de upgrade, de rescate ni de reparto libre a terceros. `scripts/` lo comprueba con `stellar contract info interface`.

**Bordes temporales complementarios** (CT-4 ampliado): `Ending ⇔ Active ∧ now ≥ end_ts`; `stop ⇔ now ≤ timeout_at`; `claim_after_timeout ⇔ now > timeout_at`; `resolve ⇔ now ≤ review_deadline`; `claim_after_review_timeout ⇔ now > review_deadline`. Para un mismo `now`, nunca pueden ejecutarse a la vez dos caminos que compitan.

### Eventos (`#[contractevent]`, data con nombres; topic 0 = nombre y topic 1 = `id`)
| Topic 0 | Data |
|---|---|
| `fz_init` | `factory, landlord, amount, end_ts, tenant_yield_bps, strategy_id, stop_bond, has_invite: bool` |
| `fz_cancel` | `landlord` |
| `fz_fund` | `tenant, amount, shares` |
| `fz_approve` | `approver, approval_count` |
| `fz_stop` | `landlord, reason_hash, bond` |
| `fz_expert` | `resolver, expert_ref` |
| `fz_report` | `resolver, report_hash` |
| `fz_settle` | `settlement: Settlement, path: SettlePath` |
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
    Paused = 21, Arithmetic = 22, InvalidConfig = 23,
    FactoryCall = 24,   // una llamada a la factory falló dentro de fund_escrow (security N-1)
}
```

## 3. Contrato `FianzaFactory` (nuevo, P1)

### Tipos (importa `Strategy`, `StrategyKind`, `RiskTier`, `Terms`, `EscrowInit`, `Escrow` y `Status` del escrow con `contractimport!`)
```rust
#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalConfig {
    pub token: Address,                 // USDC del vault por defecto
    pub treasury: Address,              // recibe el fee de plataforma y los bonds perdidos
    pub staff: Vec<Address>,            // 1..=3 → dispute_resolvers de las fianzas NUEVAS
    pub platform_fee_bps: u32,          // demo 2000; ≤ 5000
    pub timeout_secs: u64,              // demo 120; prod 30 días; ≥ 60
    pub review_timeout_secs: u64,       // demo 300; prod 30 días; ≥ 60
    pub stop_bond_min: i128,            // demo 100_000_000 (10 USDC); 0..=MAX_AMOUNT
    pub stop_bond_bps: u32,             // demo 500; ≤ 2000
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct FianzaParams {
    pub tenant: Option<Address>,
    pub invite_hash: Option<BytesN<32>>,
    pub amount: i128,
    pub end_ts: u64,
    pub tenant_yield_bps: u32,          // preset de país (INTERFACES § 6)
    pub strategy_id: Option<Symbol>,    // None → estrategia por defecto
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
| `create_fianza(landlord: Address, p: FianzaParams) -> Created` | `landlord` | no pausada (Paused); estrategia existe (StrategyNotFound) y `enabled` (StrategyDisabled); `amount ∈ (0, MAX_AMOUNT]` (InvalidAmount); `now < end_ts ≤ now + MAX_TERM_SECS` (InvalidEndTs); `tenant_yield_bps ≤ 10000` (InvalidBps); exactamente uno de `tenant`/`invite_hash` (InvalidInvite); `landlord`/`tenant` ∉ {staff, treasury, factory, token, vault} (InvalidParty); `tenant ≠ landlord` (SameParty) | `id = next_id`; `salt = id` en 32 bytes big-endian; `deployer().with_current_contract(salt).deploy_v2(wasm_hash, (EscrowInit,))`; registra `Escrow(id)`, `IdOf(addr)` e índice del casero; evento `f_created` |
| `create_fianzas_batch(landlord, items: Vec<FianzaParams>) -> Vec<Created>` **[Could]** | `landlord` (una sola firma) | `1 ≤ len ≤ MAX_BATCH` (TooMany); cada item como arriba; atómica | N despliegues. El límite real lo mide el spike (§ 10) |
| `register_tenant(id: u64, tenant: Address)` | **el escrow** (`escrow_of(id).require_auth()`, implícita al ser invocador directo) | `escrow_of(id)` existe (NotFound); el llamante es ese escrow (NotEscrow); no registrado (AlreadyRegistered) | índice del inquilino; evento `f_tenant` |
| `funding_allowed(strategy_id: Symbol) -> bool` | — | — | `!paused ∧ strategy.enabled` |
| `set_escrow_wasm_hash(hash: BytesN<32>)` | admin | — | solo afecta a fianzas **nuevas**; evento `f_wasm {old, new}` |
| `set_config(config: GlobalConfig)` | admin | válida (InvalidConfig) | solo fianzas nuevas; evento `f_config` |
| `add_strategy(s: Strategy)` | admin | `id` nuevo (StrategyExists); `≤ 10` estrategias (TooMany); `kind == DeFindexVault ⇔ vault.is_some()`; `kind == NoYield ⇒ risk == NoYield`; `vault ∉ {token, factory, treasury, staff}`; `asset == config.token` **y** `token::Client(asset).name() == s.asset_name` (fija el emisor exacto; InvalidStrategy); se guarda con `enabled = false` hasta que el admin lo habilite (dos pasos, para revisar el evento antes) | evento `f_strategy` |
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

**Eventos** (topic 0 = nombre, topic 1 = `id` cuando aplica): `f_created {escrow, landlord, amount, strategy_id}`, `f_tenant {tenant}`, `f_wasm {old, new}`, `f_config {config}`, `f_strategy {id, enabled, is_default}`, `f_paused {admin}`, `f_unpaused {admin}`.

**Errores**
```rust
#[contracterror] #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)] #[repr(u32)]
pub enum FactoryError {
    NotFound = 1, Paused = 2, InvalidConfig = 3, StrategyNotFound = 4, StrategyDisabled = 5,
    StrategyExists = 6, InvalidStrategy = 7, NotEscrow = 8, TooMany = 9, InvalidAmount = 10,
    InvalidEndTs = 11, InvalidInvite = 12, InvalidParty = 13, InvalidBps = 14,
    AlreadyRegistered = 15, SameParty = 16, Arithmetic = 17,
}
```
Validación de `GlobalConfig`: `platform_fee_bps ≤ 5000`, `stop_bond_bps ≤ 2000`, `timeout_secs ≥ 60`, `review_timeout_secs ≥ 60`, `staff` de 1 a 3 sin duplicados, `treasury ∉ staff` y `staff`, `treasury` ≠ factory.

## 4. Reparto (`modules/split`, puro) [AD-15]

```
pre: amount > 0, total ≥ 0, 0 ≤ deduction, platform_bps ≤ 10000, tenant_bps ≤ 10000
principal_back = min(total, amount)
deduction      = min(deduction, principal_back)          // el recorte lo hace settle (CT-7); split lo exige
yield          = max(total − amount, 0)                  // la pérdida se compensa PRIMERO con el rendimiento
fee            = floor(yield × platform_bps / 10000)     // fee de plataforma: solo sobre el rendimiento
net            = yield − fee
landlord_yield = floor(net × (10000 − tenant_bps) / 10000)
tenant_yield   = net − landlord_yield                    // el resto del redondeo, al inquilino
to_landlord    = deduction + landlord_yield
to_tenant      = principal_back − deduction + tenant_yield   // un déficit de principal recae aquí (Q-13)
to_treasury    = fee
post: to_tenant + to_landlord + to_treasury == total   (si no, panic: es un bug)
```
- El fee de plataforma se calcula **sobre el rendimiento bruto**.
- **El principal nunca paga fees.** Con `yield = 0`: `to_treasury = 0` y el inquilino recibe `amount − deduction` (AC-7).
- El **bond** queda fuera de `Settlement` y se paga después (security 12.7).
- `NoYield`: `total = amount` (principal líquido en el escrow) → `yield = 0`.
- Matriz obligatoria (AC-1 ampliado): `tenant_bps ∈ {0, 5000, 10000}` × `deduction ∈ {0, parcial, amount}` × `vault ∈ {ganancia, pérdida < rendimiento, pérdida > rendimiento, pérdida total}` × `platform_bps ∈ {0, 2000, 5000}`.

## 5. Subconjunto del vault de DeFindex (lo usa el escrow; lo implementa `mock-vault`)

Firmas verificadas en `paltalabs/defindex/apps/contracts/vault/src/lib.rs`:
```rust
// El vault es además el token SEP-41 de sus shares (dfTokens).
fn deposit(e: Env, amounts_desired: Vec<i128>, amounts_min: Vec<i128>, from: Address, invest: bool)
    -> Result<(Vec<i128>, i128, Option<Vec<Option<AssetInvestmentAllocation>>>), ContractError>;
fn withdraw(e: Env, withdraw_shares: i128, min_amounts_out: Vec<i128>, from: Address) -> Result<Vec<i128>, ContractError>;
fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Result<Vec<i128>, ContractError>;
fn balance(e: Env, id: Address) -> i128;
```
**Cómo lo usa el escrow (`modules/vault/defindex.rs`):**
- **deposit_all:** `authorize_as_current_contract([token.transfer(escrow, vault, amount)])`, después `try_invoke_contract::<Val, Error>(vault, "deposit", ([amount], [amount], escrow, true))`. **Se ignora el retorno** y se miden las shares con `balance(escrow)` antes y después (`> 0`, o `VaultError`). Con `invest = true` el vault invierte en sus estrategias en la misma transacción; las transferencias vault → estrategia no necesitan la auth del escrow.
- **withdraw_all:** `withdraw(shares, [0], escrow)` con `min_amounts_out = 0` **a propósito**: una pérdida no debe bloquear la salida. Se mide por diferencia de balance del token y lo absorbe `split()`. Antes de pagar siempre se retira.
- **preview_value:** `try_get_asset_amounts_per_shares(shares)[0]`; si falla, 0 (CT-10).
- **Contrato del mock (P2):** `__constructor(admin, asset)`; las mismas 4 firmas (`deposit` puede devolver `(Vec<i128>, i128)`, porque el escrow ignora el retorno); token de shares SEP-41 mínimo (`balance`, `total_supply`); `set_rate_bps(i32)` anualizado, lineal y con negativos posibles, solo admin; `InsufficientReserve` si no puede pagar. Debe **tirar con `transfer_from`-equivalente exactamente `token.transfer(from, mock, amount)`**, como DeFindex, para que el árbol de auth sea idéntico.
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
    { "id": "usdc_fixed", "kind": "defindex", "vault": "C… (usdc_paltalabs_vault u otro tras el spike)", "defindexStrategy": "CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY (USDC_blend_strategy, a confirmar)", "apyPool": "C… (pool Blend testnet)", "assetName": "USDC:G…", "risk": "standard", "simulated": false, "default": true },
    { "id": "usdc_mock", "kind": "defindex", "vault": "C… (mock-vault)", "risk": "standard", "simulated": true,  "default": false },
    { "id": "custody",   "kind": "noyield",  "vault": null, "risk": "noyield", "simulated": false, "default": false }
  ],
  "defindex": { "factory": "CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32", "vaultWasmHash": "f345228d…" },
  "admin": "G…", "staff": ["G…"], "treasury": "G…", "platformFeeBps": 2000,
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

- **§ 8 `packages/wallet`:** la interfaz `Wallet`, `WalletError`, `SignPhase`, `createWallet` y `FakeWallet` no cambian. Se mantienen los añadidos de security: `AUTH_MISMATCH`, `signatureExpirationLedger ≤ latest + 60` y `location.hostname === rpId`. **WEB-3** espera estas subinvocaciones:
  - `factory.create_fianza`: ninguna.
  - `escrow.fund_escrow`: solo `token.transfer(tenant, escrow, terms.amount)`.
  - `escrow.stop`: solo `token.transfer(landlord, escrow, terms.stop_bond)`.
  - El resto: ninguna.
  - La raíz debe ser `deployments.factory`, o un escrow con `factory.id_of(addr)` válido.
- **§ 8 `@fianzas/wallet/server`:** nueva `RelayPolicy` (arquitectura § 8.2, con los topes de security N-3).
- **§ 9 (anchor y ramp simulado):** sin cambios de interfaz; se añaden las restricciones del ramp simulado.
- **§ 10 Presets:** `tenant_yield_bps` por **preset de país**. Los presets se quedan en el front y no afirman la ley.

## 8. `packages/wallet` (P3)
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

## 9. `packages/anchor` (P3)
Implementación: `packages/anchor/src`. En la hackatón se usa el **ramp simulado** ([AD-8]); el anchor SEP-24 real queda para después (las cuentas con passkey necesitan SEP-45, que sigue en Draft).

```ts
import { createSimulatedAnchor, FakeAnchor, AnchorError } from "@fianzas/anchor";

export interface Anchor {
  // amount en unidades del token ("12.5"): lo usa el ramp simulado; en SEP-24 lo pide el anchor
  startDeposit(address: string, assetCode: string, amount?: string): Promise<{ url: string; id: string }>; // url "" si es simulado
  startWithdraw(address: string, assetCode: string, amount?: string): Promise<{ url: string; id: string }>; // simulado: NOT_SUPPORTED
  status(id: string): Promise<"pending" | "completed" | "error">;
  isSimulated: boolean; // true en el plan B: la UI lo muestra
}
export function createSimulatedAnchor(cfg: { rampUrl: string }): Anchor; // rampUrl: "/api/ramp"
export class FakeAnchor implements Anchor { constructor(delayMs?: number) }
export class AnchorError extends Error { code: "NOT_SUPPORTED" | "INVALID_AMOUNT" | "RATE_LIMITED" | "DISABLED" | "RAMP_DOWN" }
```

**Ramp simulado (`@fianzas/anchor/server`, plan B)** (security SRV-10…SRV-15):
```ts
export function createSimRampHandler(cfg: {
  networkPassphrase: string; rpcUrl: string;
  faucetSecret: string;         // RAMP_FAUCET_SECRET
  token: string;                // deployments.token
  accountWasmHashes: string[];  // [deployments.smartAccount.accountWasmHash]
  enabled: boolean;             // RAMP_ENABLED
  allowedOrigins: string[];
  maxAmount: string; perAddressCap: string; perIpPerHour: number; globalHourlyCap: number;
}): { POST: (req: Request) => Promise<Response>; GET: (req: Request) => Promise<Response> };
// app/api/ramp/route.ts: export const { POST, GET } = createSimRampHandler({ … })
```
- `POST { to, amount }` → `{ id, status: "completed" }` cuando la transferencia se confirma. `GET ?id=` → `{ status }`, solo de ids emitidos por esa instancia.
- `createSimRampHandler` lanza una excepción al construirse con la *passphrase* de mainnet.
- Solo envía a C-address que sean smart accounts nuestros (ejecutable = `smartAccount.accountWasmHash`).
- `amount` validado con `^\d{1,6}(\.\d{1,7})?$` y convertido con `BigInt`. Topes por petición, por dirección, por IP y global por hora. Con `RAMP_ENABLED=0` responde `403`. Una transacción de la faucet a la vez.
- La cuenta faucet es exclusiva (no es staff, admin, treasury ni deployer) y tiene saldo acotado.

## 10. Presets de política de yield (P4 en el front)
| Preset | `tenant_yield_bps` |
|---|---|
| Todo al inquilino | 10000 |
| 50/50 | 5000 |
| Todo al casero | 0 |
| Personalizado | 0–10000 |

Los presets **no** afirman qué dice la ley de cada país. La UI lo indica.
