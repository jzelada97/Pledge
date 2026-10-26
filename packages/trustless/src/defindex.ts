// Rendimiento de la fianza en el vault de DeFindex de Trustless Work. Ya no hay supuestos: el
// escrow deposita al fondear y `GET /escrow/single-release/vault-position` da su valor actual.
import type { VaultPosition } from "./types";
import { floorToUnits } from "./units";

/** Vault de DeFindex que usa la API si el deploy no manda `vault` (testnet). */
export const TW_VAULT_TESTNET = "CCG3G4YUO3FOPCTZXDSXOB3VXLOWVW3G5FB6RJNB45TYQ34SBS7TS7ZJ";
/** wasm del escrow single-release con vault (testnet), para la RelayPolicy de packages/wallet. */
export const TW_ESCROW_WASM_TESTNET = "828ae58429c6bf7a2da16784d89871f11e07fd7a82326de7f0817c80c02e4b95";
/** Dirección que cobra la comisión de TW en testnet (segundo argumento de release_funds). */
export const TW_FEE_ADDRESS_TESTNET = "GBPUACN7QETR4TCYTKINBDHTYTFXD3BQQV7VSMZC5CX74E4MTUL2AMUB";
/**
 * Contrato deployer de TW (testnet) y la función que llama el XDR de `POST /deployer/single-release`.
 * Sirve para comprobar un despliegue antes de firmarlo. Sacado de dos despliegues reales
 * (`9f084fac…de25`, #80, y `67ed5da5…97ed`, #84).
 */
export const TW_DEPLOYER_TESTNET = "CBTENJ2ATPZTN5ZE5LMAQVX64DF3OMNZHVIUSMB7CQSEK2R6EN4ZGEJI";
export const TW_DEPLOY_FN = "tw_new_single_release_escrow";
/** Comisión de Trustless Work: 0,3 % sobre todo lo retirado (capital + rendimiento). */
export const TW_FEE_BPS = 30;

const BPS = 10_000n;

/**
 * Rendimiento acumulado en unidad mínima: valor en el vault menos lo fondeado. Justo después de
 * fondear puede salir -1 stroop por el redondeo del vault; se devuelve 0. `underlying` sale de
 * valorar las shares y puede traer más de 7 decimales: se trunca.
 */
export function accruedYield(position: VaultPosition, funded: bigint): bigint {
  const diff = floorToUnits(position.underlying) - funded;
  return diff > 0n ? diff : 0n;
}

/**
 * Lo que cobra el receptor al liberar un total retirado (unidad mínima), descontando la comisión de
 * TW y la de la plataforma (`platformFee` en %). Sirve para mostrar el importe esperado.
 */
export function expectedPayout(total: bigint, platformFeePercent: number): bigint {
  if (!Number.isInteger(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 99) {
    throw new RangeError(`platformFee fuera de rango (0–99): ${platformFeePercent}`);
  }
  const twFee = (total * BigInt(TW_FEE_BPS)) / BPS;
  const platform = (total * BigInt(platformFeePercent) * 100n) / BPS;
  return total - twFee - platform;
}
