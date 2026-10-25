// Ampliación de DeFindex que Trustless Work va a añadir a su API v2 actual. Todavía no existe:
// todo lo que suponemos de ella vive SOLO en este archivo. Cuando TW la publique, se ajustan
// estos tipos y funciones (y sus tests) y el resto del paquete no cambia.
import type { DeployV2Body, SingleReleaseV2Escrow } from "./types";
import { fromDecimal } from "./units";

const MAX_BPS = 10_000;

/** Cómo queremos que rinda y se reparta la fianza (lo decide nuestra plataforma). */
export interface DefindexStrategy {
  /** Vault de DeFindex (`C…`) de nuestro registro de estrategias. */
  vault: string;
  /** Comisión de la plataforma sobre el rendimiento, en bps (demo: 2000). */
  platformYieldFeeBps: number;
  /** Parte del rendimiento neto para el inquilino según la jurisdicción (Portugal: 0). */
  tenantYieldBps: number;
}

// SUPUESTO: el despliegue acepta un objeto `defindex` de primer nivel con el vault y el
// reparto del rendimiento entre los roles del escrow (receiver = inquilino, serviceProvider
// = casero, platform = tesorería). El principal siempre vuelve entero al receiver.
export interface DefindexDeployExtension {
  defindex: {
    vaultContractId: string;
    yieldDistribution: { platformBps: number; receiverBps: number; serviceProviderBps: number };
  };
}

export type DeployWithDefindex = DeployV2Body & DefindexDeployExtension;

/** Añade la ampliación de DeFindex al cuerpo de despliegue. */
export function withDefindex(body: DeployV2Body, s: DefindexStrategy): DeployWithDefindex {
  for (const [name, bps] of [
    ["platformYieldFeeBps", s.platformYieldFeeBps],
    ["tenantYieldBps", s.tenantYieldBps],
  ] as const) {
    if (!Number.isInteger(bps) || bps < 0 || bps > MAX_BPS) {
      throw new RangeError(`${name} fuera de rango (0–10000): ${bps}`);
    }
  }
  if (!/^C[A-Z2-7]{55}$/.test(s.vault)) throw new RangeError(`Vault no válido: ${s.vault}`);
  // El neto (rendimiento − comisión) se reparte entre inquilino y casero; los tres suman 10000.
  const net = MAX_BPS - s.platformYieldFeeBps;
  const receiverBps = Math.floor((net * s.tenantYieldBps) / MAX_BPS);
  return {
    ...body,
    defindex: {
      vaultContractId: s.vault,
      yieldDistribution: {
        platformBps: s.platformYieldFeeBps,
        receiverBps,
        serviceProviderBps: net - receiverBps,
      },
    },
  };
}

// SUPUESTO: la respuesta de `GET /escrow/single-release/v2/{contractId}` añadirá un objeto
// `defindex` con el vault y el rendimiento acumulado en decimales.
export interface DefindexEscrowInfo {
  vaultContractId: string;
  accruedYield: number;
}

/** Rendimiento acumulado en unidad mínima, o `null` si el escrow no rinde (o TW aún no lo da). */
export function accruedYield(escrow: SingleReleaseV2Escrow): bigint | null {
  const info = (escrow as SingleReleaseV2Escrow & { defindex?: DefindexEscrowInfo }).defindex;
  if (!info || typeof info.accruedYield !== "number") return null;
  return fromDecimal(info.accruedYield);
}
