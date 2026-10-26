// Errores de los contratos (`Error(Contract, #N)` en la simulación) → Problem Details.
// Códigos de TW cuando el concepto coincide y FZ_* para los nuestros (INTERFACES § 8, convención 5).
// Siempre se conserva `extensions.contractError`.
import { Problem } from "./problem";

type Mapped = [status: number, code: string, title: string];

// contracts/escrow/src/error.rs
const ESCROW: Record<number, Mapped> = {
  1: [409, "FZ_BAD_STATUS", "La fianza no está en el estado que exige esta operación"],
  2: [403, "ESCROW_UNAUTHORIZED_APPROVER", "Solo el casero o el inquilino pueden hacerlo"],
  3: [409, "ESCROW_APPROVER_ALREADY_APPROVED_MILESTONE", "Esta parte ya aprobó la devolución"],
  4: [409, "FZ_TIMEOUT_NOT_REACHED", "Aún no ha vencido el plazo"],
  5: [422, "FZ_INVALID_BPS", "Porcentaje no válido"],
  6: [422, "FZ_INVALID_AMOUNT", "Importe no válido"],
  7: [422, "FZ_DEDUCTION_TOO_HIGH", "La deducción supera la fianza"],
  8: [503, "FZ_VAULT_UNAVAILABLE", "El vault no responde o no tiene liquidez; reinténtalo en unos minutos"],
  9: [422, "FZ_INVALID_INVITE", "Código de invitación no válido"],
  10: [409, "FZ_DEADLINE_PASSED", "El plazo ya ha pasado"],
  11: [422, "FZ_SAME_PARTY", "Casero e inquilino no pueden ser la misma cuenta"],
  12: [422, "FZ_INVALID_END_TS", "Fecha de fin no válida"],
  13: [409, "FZ_REPORT_MISSING", "Falta el informe del perito"],
  14: [422, "FZ_INVALID_PARTY", "Esa cuenta no puede ser parte de la fianza"],
  15: [422, "FZ_INCOHERENT_RESOLUTION", "Una parada no justificada no admite deducción"],
  16: [422, "FZ_INSUFFICIENT_BOND", "Saldo insuficiente para el depósito de parada"],
  17: [409, "ESCROW_PROPERTIES_MISMATCH", "Las condiciones de la fianza no coinciden con las firmadas"],
  18: [403, "ESCROW_ONLY_DISPUTE_RESOLVER_CAN_EXECUTE", "Solo el staff puede resolver"],
  19: [409, "FZ_REVIEW_TIMEOUT_NOT_REACHED", "Aún no ha vencido el plazo de revisión"],
  20: [409, "FZ_REVIEW_DEADLINE_PASSED", "El plazo de revisión ya ha pasado"],
  21: [503, "FZ_PAUSED", "Las altas están pausadas"],
  22: [500, "FZ_ARITHMETIC", "Error aritmético en el contrato"],
  23: [500, "FZ_INVALID_CONFIG", "Configuración del contrato no válida"],
  24: [502, "FZ_FACTORY_CALL", "La factory no respondió"],
  25: [409, "FZ_VAULT_FEE_CHANGED", "El vault subió sus comisiones desde que se creó la fianza"],
};

// contracts/factory/src/error.rs
const FACTORY: Record<number, Mapped> = {
  1: [404, "ESCROW_NOT_FOUND", "No existe esa fianza"],
  2: [503, "FZ_PAUSED", "Las altas están pausadas"],
  3: [500, "FZ_INVALID_CONFIG", "Configuración de la factory no válida"],
  4: [422, "FZ_STRATEGY_NOT_FOUND", "No existe esa estrategia"],
  5: [422, "FZ_STRATEGY_DISABLED", "La estrategia no admite fianzas nuevas"],
  6: [409, "FZ_STRATEGY_EXISTS", "La estrategia ya existe"],
  7: [422, "FZ_INVALID_STRATEGY", "Estrategia no válida"],
  8: [404, "ESCROW_NOT_FOUND", "Ese contrato no es una fianza de la plataforma"],
  9: [422, "FZ_TOO_MANY", "Demasiados elementos"],
  10: [422, "FZ_INVALID_AMOUNT", "Importe no válido"],
  11: [422, "FZ_INVALID_END_TS", "Fecha de fin no válida"],
  12: [422, "FZ_INVALID_INVITE", "Indica el inquilino o el hash de invitación, no los dos"],
  13: [422, "FZ_INVALID_PARTY", "Esa cuenta no puede ser parte de la fianza"],
  14: [422, "FZ_INVALID_BPS", "Porcentaje no válido"],
  15: [409, "FZ_ALREADY_REGISTERED", "El inquilino ya está registrado"],
  16: [422, "FZ_SAME_PARTY", "Casero e inquilino no pueden ser la misma cuenta"],
  17: [500, "FZ_ARITHMETIC", "Error aritmético en la factory"],
  18: [422, "FZ_VAULT_FEE_TOO_HIGH", "La comisión del vault supera el tope de la estrategia"],
  19: [422, "FZ_VAULT_NOT_PLATFORM_MANAGED", "El vault ya no lo gestiona la plataforma"],
  20: [409, "FZ_NONCE_USED", "Ese nonce ya se usó; genera otro"],
  21: [409, "FZ_CONFIG_CHANGED", "La configuración cambió; vuelve a leer configVersion y reintenta"],
};

const TABLES = { escrow: ESCROW, factory: FACTORY } as const;
export type ContractKind = keyof typeof TABLES;

export function mapContractError(kind: ContractKind, err: unknown): unknown {
  if (!(err instanceof Problem)) return err;
  const n = err.extensions?.contractError;
  if (typeof n !== "number") return err;
  const m = TABLES[kind][n];
  if (!m) return err;
  return new Problem(m[0], m[1], m[2], err.detail, { ...err.extensions, contractError: n });
}

/** Ejecuta `fn` y traduce el error de contrato con la tabla de `kind`. */
export async function withContractErrors<T>(kind: ContractKind, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw mapContractError(kind, e);
  }
}
