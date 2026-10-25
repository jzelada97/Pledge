// Errores RFC 9457 Problem Details, con los códigos de Trustless Work cuando el concepto coincide
// y FZ_* para los nuestros (arquitectura § 6.8, convención 5).
import type { Context } from "hono";

export const ERROR_TYPE_BASE = "https://github.com/jzelada97/stellar-fianzas/blob/main/docs/INTERFACES.md#errores";

export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly extensions?: Record<string, unknown>,
  ) {
    super(detail ?? title);
    this.name = "Problem";
  }
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance: string;
  traceId: string;
  extensions?: Record<string, unknown>;
}

export function toProblemDetails(p: Problem, instance: string, traceId: string): ProblemDetails {
  return {
    type: `${ERROR_TYPE_BASE}:${p.code}`,
    title: p.title,
    status: p.status,
    code: p.code,
    ...(p.detail ? { detail: p.detail } : {}),
    instance,
    traceId,
    ...(p.extensions ? { extensions: p.extensions } : {}),
  };
}

export function problemResponse(c: Context, p: Problem): Response {
  const traceId = c.get("traceId") ?? crypto.randomUUID();
  const body = toProblemDetails(p, new URL(c.req.url).pathname, traceId);
  return new Response(JSON.stringify(body), {
    status: p.status,
    headers: { "content-type": "application/problem+json", "x-trace-id": traceId },
  });
}

export const validationError = (detail: string, extensions?: Record<string, unknown>) =>
  new Problem(400, "VALIDATION_ERROR", "Petición no válida", detail, extensions);

export const notFound = (detail = "Ruta no encontrada") => new Problem(404, "NOT_FOUND", "No encontrado", detail);

// Rutas de TW que no implementamos o que cambian de semántica: 501 con la ruta de reemplazo.
export const notSupported = (detail: string, replacement?: string) =>
  new Problem(501, "FZ_ENDPOINT_NOT_SUPPORTED", "Endpoint no soportado en esta API", detail, replacement ? { replacement } : undefined);

export const notImplementedYet = (detail: string) =>
  new Problem(501, "FZ_NOT_IMPLEMENTED_YET", "Endpoint previsto, aún sin implementar", detail);

export const serviceDisabled = (detail: string) => new Problem(503, "FZ_SERVICE_DISABLED", "Servicio no configurado", detail);
