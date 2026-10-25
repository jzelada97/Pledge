// Piezas comunes de las rutas que operan sobre fianzas (/fianzas/v1 y las compatibles con TW).
import { Address } from "@stellar/stellar-sdk";
import { Client as FactoryClient } from "@fianzas/bindings/factory";
import type { ApiConfig } from "./config";
import type { Chain, TtlCache } from "./chain";
import { withContractErrors } from "./contract-errors";
import { serviceDisabled } from "./problem";

// La relación escrow ↔ id de la factory no cambia nunca (FAC-1): se puede cachear mucho.
const ID_OF_TTL = 10 * 60_000;

export function escrowHelpers(cfg: ApiConfig, chain: Chain, cache: TtlCache) {
  const d = cfg.deployments;
  let spec: FactoryClient["spec"] | null = null;

  function requireFactory(): string {
    if (!d.factory) throw serviceDisabled("La factory aún no está desplegada (deployments.factory)");
    return d.factory;
  }

  return {
    requireFactory,

    /** Spec de la factory (bindings) para codificar structs como FianzaParams sin hacerlo a mano. */
    factorySpec() {
      spec ??= new FactoryClient({
        contractId: requireFactory(),
        networkPassphrase: cfg.networkPassphrase,
        rpcUrl: cfg.rpcUrl,
      }).spec;
      return spec;
    },

    /**
     * Id de la fianza si `contractId` es un escrow de nuestra factory; si no, 404 ESCROW_NOT_FOUND.
     * Así ninguna ruta construye transacciones contra contratos ajenos.
     */
    ensureEscrow(contractId: string): Promise<number> {
      const factory = requireFactory();
      return cache.get(`idOf:${contractId}`, ID_OF_TTL, () =>
        withContractErrors("factory", async () =>
          Number(await chain.read<bigint>(factory, "id_of", [new Address(contractId).toScVal()])),
        ),
      );
    },
  };
}

export type EscrowHelpers = ReturnType<typeof escrowHelpers>;
