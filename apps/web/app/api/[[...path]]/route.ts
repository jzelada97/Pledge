// Catch-all que monta @fianzas/api dentro de apps/web: una sola origin, sin CORS para nuestro front
// y los secretos (Relayer, faucet, API keys) solo en el entorno del servidor (arquitectura § 6.8.6).
import { nextHandlers } from "@fianzas/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const h = nextHandlers();
export const GET = h.GET;
export const POST = h.POST;
export const PUT = h.PUT;
export const PATCH = h.PATCH;
export const DELETE = h.DELETE;
export const OPTIONS = h.OPTIONS;
