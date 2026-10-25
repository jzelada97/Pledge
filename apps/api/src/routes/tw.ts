// Rutas de la Core API v2 de Trustless Work (arquitectura § 6.8.1).
// - Las que no implementamos o cambian de semántica responden 501 con `extensions.replacement`,
//   para que un hook del SDK de TW nunca mueva dinero de una forma distinta a la que el integrador cree.
// - Las compatibles (fund, approve-*, extend-ttl y lecturas) llegan con la factory y los bindings.
import { Hono } from "hono";
import { notImplementedYet, notSupported } from "../problem";

const SR = "/escrow/single-release/v2";

export const TW_NOT_SUPPORTED: Array<{ method: "post" | "put"; path: string; detail: string; replacement?: string }> = [
  { method: "post", path: `${SR}/deploy`, detail: "Roles, comisiones y token los fija la factory, no el llamante", replacement: "POST /api/fianzas/v1/fianzas" },
  { method: "post", path: `${SR}/release-funds`, detail: "No hay liberación separada: la segunda aprobación liquida", replacement: `POST /api${SR}/approve-and-release-milestones` },
  { method: "post", path: `${SR}/change-milestone-status`, detail: "La fianza no tiene estados de milestone" },
  { method: "post", path: `${SR}/dispute`, detail: "Solo el casero puede parar, deposita un bond y el motivo va como hash", replacement: "POST /api/fianzas/v1/fianzas/{contractId}/stop" },
  { method: "post", path: `${SR}/resolve-dispute`, detail: "No hay reparto libre: se resuelve con deduction y stopJustified", replacement: "POST /api/fianzas/v1/fianzas/{contractId}/resolve" },
  { method: "post", path: `${SR}/withdraw-remaining-funds`, detail: "Eliminado en el fork" },
  { method: "put", path: `${SR}/update`, detail: "Los Terms de una fianza son inmutables" },
  { method: "post", path: `${SR}/manage-milestones`, detail: "La fianza no tiene milestones editables" },
  { method: "post", path: "/graphql", detail: "Sin GraphQL en el MVP" },
];

export const TW_COMPATIBLE_PENDING = [
  `${SR}/fund`,
  `${SR}/approve-milestones`,
  `${SR}/approve-and-release-milestones`,
  `${SR}/extend-ttl`,
];

export function twRoutes() {
  const r = new Hono();
  for (const e of TW_NOT_SUPPORTED) {
    r[e.method](e.path, () => {
      throw notSupported(e.detail, e.replacement);
    });
  }
  for (const p of TW_COMPATIBLE_PENDING) {
    r.post(p, () => {
      throw notImplementedYet(`${p}: pendiente del despliegue de la factory y de los bindings (fase 3a)`);
    });
  }
  r.get(`${SR}/:contractId`, () => {
    throw notImplementedYet("lectura del escrow en forma TW: pendiente de los bindings (fase 3a)");
  });
  r.get("/escrows", () => {
    throw notImplementedYet("GET /escrows: pendiente de la factory (fase 3a)");
  });
  r.get("/escrows/*", () => {
    throw notImplementedYet("lecturas /escrows/*: pendientes de la factory (fase 3a)");
  });
  return r;
}
