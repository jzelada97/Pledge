// Validación de entrada común a las rutas: cuerpo JSON con zod y direcciones de Stellar.
import type { Context } from "hono";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import type { Built, UnsignedTransactionResponse } from "./chain";
import { validationError } from "./problem";

export const accountAddress = z
  .string()
  .refine((s) => StrKey.isValidEd25519PublicKey(s) || StrKey.isValidContract(s), "dirección G… o C… no válida");
export const contractAddress = z.string().refine((s) => StrKey.isValidContract(s), "dirección de contrato C… no válida");
export const hex32 = z.string().regex(/^[0-9a-fA-F]{64}$/, "32 bytes en hexadecimal");
export const amountInput = z.union([z.number().positive(), z.string().min(1)]);

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw validationError("El cuerpo debe ser JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw validationError(parsed.error.issues.map((i) => `${i.path.join(".") || "cuerpo"}: ${i.message}`).join("; "), {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function contractParam(c: Context): string {
  const id = c.req.param("contractId") ?? "";
  if (!StrKey.isValidContract(id)) throw validationError("contractId debe ser una dirección C…");
  return id;
}

/** La respuesta pública de un build: sin el retorno simulado. */
export function utr({ result: _result, ...rest }: Built): UnsignedTransactionResponse {
  return rest;
}
