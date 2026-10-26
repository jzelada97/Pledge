import type { Locale } from "../config";
import { en, type Messages } from "./en";
import { es } from "./es";
import { pt } from "./pt";

export const MESSAGES: Record<Locale, Messages> = { en, pt, es };
export type { Messages };
