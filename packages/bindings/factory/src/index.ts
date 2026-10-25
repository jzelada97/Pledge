import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const FactoryError = {
  1: {message:"NotFound"},
  2: {message:"Paused"},
  3: {message:"InvalidConfig"},
  4: {message:"StrategyNotFound"},
  5: {message:"StrategyDisabled"},
  6: {message:"StrategyExists"},
  7: {message:"InvalidStrategy"},
  8: {message:"NotEscrow"},
  9: {message:"TooMany"},
  10: {message:"InvalidAmount"},
  11: {message:"InvalidEndTs"},
  12: {message:"InvalidInvite"},
  13: {message:"InvalidParty"},
  14: {message:"InvalidBps"},
  15: {message:"AlreadyRegistered"},
  16: {message:"SameParty"},
  17: {message:"Arithmetic"},
  18: {message:"VaultFeeTooHigh"},
  19: {message:"VaultNotPlatformManaged"},
  20: {message:"NonceUsed"},
  21: {message:"ConfigChanged"}
}


export interface Created {
  escrow: string;
  id: u64;
  wasm_hash: Buffer;
}


export interface FianzaParams {
  amount: i128;
  end_ts: u64;
  expected_config_version: u32;
  invite_hash: Option<Buffer>;
  nonce: Buffer;
  strategy_id: Option<string>;
  tenant: Option<string>;
}


export interface GlobalConfig {
  platform_fee_bps: u32;
  review_timeout_secs: u64;
  staff: Array<string>;
  stop_bond_bps: u32;
  stop_bond_min: i128;
  tenant_yield_bps: u32;
  timeout_secs: u64;
  token: string;
  treasury: string;
  tw_fee_bps: u32;
  tw_fee_receiver: Option<string>;
  vault_manager: Option<string>;
}


export interface FianzaSummary {
  data: Escrow;
  escrow: string;
  id: u64;
  status: Status;
}


export interface Terms {
  amount: i128;
  defindex_protocol_fee_bps: u32;
  defindex_vault_fee_bps: u32;
  dispute_resolvers: Array<string>;
  end_ts: u64;
  factory: string;
  id: u64;
  landlord: string;
  platform_fee_bps: u32;
  review_timeout_secs: u64;
  stop_bond: i128;
  strategy: Strategy;
  tenant_yield_bps: u32;
  timeout_secs: u64;
  treasury: string;
  tw_fee_bps: u32;
  tw_fee_receiver: Option<string>;
}


export interface Escrow {
  approvals: Approvals;
  created_ts: u64;
  dispute: Dispute;
  funded_ts: u64;
  invite_hash: Option<Buffer>;
  path: SettlePath;
  settlement: Settlement;
  shares: i128;
  status: Status;
  tenant: Option<string>;
  terms: Terms;
}

export type Status = {tag: "Proposed", values: void} | {tag: "Active", values: void} | {tag: "Ending", values: void} | {tag: "Stopped", values: void} | {tag: "UnderReview", values: void} | {tag: "Settled", values: void} | {tag: "Cancelled", values: void};


export interface Dispute {
  bond_held: i128;
  expert_ref: Option<Buffer>;
  reason_hash: Option<Buffer>;
  report_hash: Option<Buffer>;
  stop_justified: Option<boolean>;
  stopped_ts: u64;
}

export type RiskTier = {tag: "NoYield", values: void} | {tag: "Standard", values: void} | {tag: "High", values: void};


export interface Strategy {
  apy_pool: Option<string>;
  asset: string;
  asset_name: string;
  defindex_strategy: Option<string>;
  enabled: boolean;
  id: string;
  kind: StrategyKind;
  max_vault_fee_bps: u32;
  risk: RiskTier;
  simulated: boolean;
  vault: Option<string>;
}


export interface Approvals {
  approval_count: u32;
  approved_by: Array<string>;
  target: u32;
}


export interface Settlement {
  deduction: i128;
  to_landlord: i128;
  to_tenant: i128;
  to_treasury: i128;
  to_tw: i128;
  total: i128;
  yield_total: i128;
}

export type SettlePath = {tag: "Pending", values: void} | {tag: "Approved", values: void} | {tag: "Resolved", values: void} | {tag: "Timeout", values: void} | {tag: "ReviewTimeout", values: void};

export type StrategyKind = {tag: "NoYield", values: void} | {tag: "DeFindexVault", values: void};








export interface Client {
  /**
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a id_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  id_of: ({escrow}: {escrow: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<GlobalConfig>>

  /**
   * Construct and simulate a paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unpause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  strategy: ({id}: {id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Strategy>>>

  /**
   * Construct and simulate a escrow_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  escrow_of: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a set_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_config: ({config}: {config: GlobalConfig}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a strategies transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  strategies: (options?: MethodOptions) => Promise<AssembledTransaction<Array<Strategy>>>

  /**
   * Construct and simulate a get_fianzas transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sin llamar al vault (presupuesto): solo `escrow.get_escrow()` por id.
   */
  get_fianzas: ({ids}: {ids: Array<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<FianzaSummary>>>>

  /**
   * Construct and simulate a add_strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Se guarda deshabilitada: el admin la habilita en un segundo paso tras revisar el evento.
   */
  add_strategy: ({s}: {s: Strategy}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_fianza transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_fianza: ({landlord, p}: {landlord: string, p: FianzaParams}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Created>>>

  /**
   * Construct and simulate a config_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config_version: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a list_by_tenant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  list_by_tenant: ({tenant, start, limit}: {tenant: string, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<u64>>>>

  /**
   * Construct and simulate a count_by_tenant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  count_by_tenant: ({tenant}: {tenant: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a funding_allowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `!paused ∧ strategy.enabled` y, si hay vault, sus comisiones y su manager siguen
   * dentro de lo admitido (FAC-8, fail-closed).
   */
  funding_allowed: ({strategy_id}: {strategy_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a predict_address transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  predict_address: ({landlord, nonce}: {landlord: string, nonce: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a register_tenant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * FAC-5: solo la llama el propio escrow desde `fund_escrow` (invocador directo).
   */
  register_tenant: ({id, tenant}: {id: u64, tenant: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a default_strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  default_strategy: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Strategy>>>

  /**
   * Construct and simulate a escrow_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  escrow_wasm_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a list_by_landlord transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  list_by_landlord: ({landlord, start, limit}: {landlord: string, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<u64>>>>

  /**
   * Construct and simulate a count_by_landlord transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  count_by_landlord: ({landlord}: {landlord: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a create_fianzas_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * FAC-9: atómica (un fallo revierte todos los despliegues) y con una sola firma del
   * casero. No pasa por el Relayer (N-3).
   */
  create_fianzas_batch: ({landlord, items}: {landlord: string, items: Array<FianzaParams>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<Created>>>>

  /**
   * Construct and simulate a set_default_strategy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_default_strategy: ({id}: {id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_escrow_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_escrow_wasm_hash: ({hash}: {hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_strategy_enabled transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_strategy_enabled: ({id, enabled}: {id: string, enabled: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, escrow_wasm_hash, config}: {admin: string, escrow_wasm_hash: Buffer, config: GlobalConfig},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, escrow_wasm_hash, config}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "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",
        "AAAAAQAAAAAAAAAAAAAACUFwcHJvdmFscwAAAAAAAAMAAAAAAAAADmFwcHJvdmFsX2NvdW50AAAAAAAEAAAAAAAAAAthcHByb3ZlZF9ieQAAAAPqAAAAEwAAAAAAAAAGdGFyZ2V0AAAAAAAE",
        "AAAAAQAAAAAAAAAAAAAAClNldHRsZW1lbnQAAAAAAAcAAAAAAAAACWRlZHVjdGlvbgAAAAAAAAsAAAAAAAAAC3RvX2xhbmRsb3JkAAAAAAsAAAAAAAAACXRvX3RlbmFudAAAAAAAAAsAAAAAAAAAC3RvX3RyZWFzdXJ5AAAAAAsAAAAAAAAABXRvX3R3AAAAAAAACwAAAAAAAAAFdG90YWwAAAAAAAALAAAAAAAAAAt5aWVsZF90b3RhbAAAAAAL",
        "AAAAAgAAAAAAAAAAAAAAClNldHRsZVBhdGgAAAAAAAUAAAAAAAAAAAAAAAdQZW5kaW5nAAAAAAAAAAAAAAAACEFwcHJvdmVkAAAAAAAAAAAAAAAIUmVzb2x2ZWQAAAAAAAAAAAAAAAdUaW1lb3V0AAAAAAAAAAAAAAAADVJldmlld1RpbWVvdXQAAAA=",
        "AAAAAgAAAAAAAAAAAAAADFN0cmF0ZWd5S2luZAAAAAIAAAAAAAAAAAAAAAdOb1lpZWxkAAAAAAAAAAAAAAAADURlRmluZGV4VmF1bHQAAAA=",
        "AAAABQAAAAAAAAAAAAAABUZXYXNtAAAAAAAAAQAAAAZmX3dhc20AAAAAAAIAAAAAAAAAA29sZAAAAAPuAAAAIAAAAAAAAAAAAAAAA25ldwAAAAPuAAAAIAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAB0ZDb25maWcAAAAAAQAAAAhmX2NvbmZpZwAAAAEAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAxHbG9iYWxDb25maWcAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAB0ZQYXVzZWQAAAAAAQAAAAhmX3BhdXNlZAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAB0ZUZW5hbnQAAAAAAQAAAAhmX3RlbmFudAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAGdGVuYW50AAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAACEZDcmVhdGVkAAAAAQAAAAlmX2NyZWF0ZWQAAAAAAAAIAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAABmVzY3JvdwAAAAAAEwAAAAAAAAAAAAAACGxhbmRsb3JkAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAAC3N0cmF0ZWd5X2lkAAAAABEAAAAAAAAAAAAAABZkZWZpbmRleF92YXVsdF9mZWVfYnBzAAAAAAAEAAAAAAAAAAAAAAAZZGVmaW5kZXhfcHJvdG9jb2xfZmVlX2JwcwAAAAAAAAQAAAAAAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACUZTdHJhdGVneQAAAAAAAAEAAAAKZl9zdHJhdGVneQAAAAAABQAAAAAAAAACaWQAAAAAABEAAAAAAAAAAAAAAAdlbmFibGVkAAAAAAEAAAAAAAAAAAAAAAppc19kZWZhdWx0AAAAAAABAAAAAAAAAAAAAAAEcmlzawAAB9AAAAAIUmlza1RpZXIAAAAAAAAAAAAAABFtYXhfdmF1bHRfZmVlX2JwcwAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAACUZVbnBhdXNlZAAAAAAAAAEAAAAKZl91bnBhdXNlZAAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAI=",
        "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAFY291bnQAAAAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAAAAAAAFaWRfb2YAAAAAAAABAAAAAAAAAAZlc2Nyb3cAAAAAABMAAAABAAAD6QAAAAYAAAfQAAAADEZhY3RvcnlFcnJvcg==",
        "AAAAAAAAAAAAAAAFcGF1c2UAAAAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAB9AAAAAMR2xvYmFsQ29uZmln",
        "AAAAAAAAAAAAAAAGcGF1c2VkAAAAAAAAAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAHdW5wYXVzZQAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAIc3RyYXRlZ3kAAAABAAAAAAAAAAJpZAAAAAAAEQAAAAEAAAPpAAAH0AAAAAhTdHJhdGVneQAAB9AAAAAMRmFjdG9yeUVycm9y",
        "AAAAAAAAAAAAAAAJZXNjcm93X29mAAAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAABMAAAfQAAAADEZhY3RvcnlFcnJvcg==",
        "AAAAAAAAAAAAAAAKc2V0X2NvbmZpZwAAAAAAAQAAAAAAAAAGY29uZmlnAAAAAAfQAAAADEdsb2JhbENvbmZpZwAAAAEAAAPpAAAAAgAAB9AAAAAMRmFjdG9yeUVycm9y",
        "AAAAAAAAAAAAAAAKc3RyYXRlZ2llcwAAAAAAAAAAAAEAAAPqAAAH0AAAAAhTdHJhdGVneQ==",
        "AAAAAAAAAEVTaW4gbGxhbWFyIGFsIHZhdWx0IChwcmVzdXB1ZXN0byk6IHNvbG8gYGVzY3Jvdy5nZXRfZXNjcm93KClgIHBvciBpZC4AAAAAAAALZ2V0X2ZpYW56YXMAAAAAAQAAAAAAAAADaWRzAAAAA+oAAAAGAAAAAQAAA+kAAAPqAAAH0AAAAA1GaWFuemFTdW1tYXJ5AAAAAAAH0AAAAAxGYWN0b3J5RXJyb3I=",
        "AAAAAAAAAFhTZSBndWFyZGEgZGVzaGFiaWxpdGFkYTogZWwgYWRtaW4gbGEgaGFiaWxpdGEgZW4gdW4gc2VndW5kbyBwYXNvIHRyYXMgcmV2aXNhciBlbCBldmVudG8uAAAADGFkZF9zdHJhdGVneQAAAAEAAAAAAAAAAXMAAAAAAAfQAAAACFN0cmF0ZWd5AAAAAQAAA+kAAAACAAAH0AAAAAxGYWN0b3J5RXJyb3I=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAQZXNjcm93X3dhc21faGFzaAAAA+4AAAAgAAAAAAAAAAZjb25maWcAAAAAB9AAAAAMR2xvYmFsQ29uZmlnAAAAAA==",
        "AAAAAAAAAAAAAAANY3JlYXRlX2ZpYW56YQAAAAAAAAIAAAAAAAAACGxhbmRsb3JkAAAAEwAAAAAAAAABcAAAAAAAB9AAAAAMRmlhbnphUGFyYW1zAAAAAQAAA+kAAAfQAAAAB0NyZWF0ZWQAAAAH0AAAAAxGYWN0b3J5RXJyb3I=",
        "AAAAAAAAAAAAAAAOY29uZmlnX3ZlcnNpb24AAAAAAAAAAAABAAAABA==",
        "AAAAAAAAAAAAAAAObGlzdF9ieV90ZW5hbnQAAAAAAAMAAAAAAAAABnRlbmFudAAAAAAAEwAAAAAAAAAFc3RhcnQAAAAAAAAEAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6QAAA+oAAAAGAAAH0AAAAAxGYWN0b3J5RXJyb3I=",
        "AAAAAAAAAAAAAAAPY291bnRfYnlfdGVuYW50AAAAAAEAAAAAAAAABnRlbmFudAAAAAAAEwAAAAEAAAAE",
        "AAAAAAAAAH5gIXBhdXNlZCDiiKcgc3RyYXRlZ3kuZW5hYmxlZGAgeSwgc2kgaGF5IHZhdWx0LCBzdXMgY29taXNpb25lcyB5IHN1IG1hbmFnZXIgc2lndWVuCmRlbnRybyBkZSBsbyBhZG1pdGlkbyAoRkFDLTgsIGZhaWwtY2xvc2VkKS4AAAAAAA9mdW5kaW5nX2FsbG93ZWQAAAAAAQAAAAAAAAALc3RyYXRlZ3lfaWQAAAAAEQAAAAEAAAAB",
        "AAAAAAAAAAAAAAAPcHJlZGljdF9hZGRyZXNzAAAAAAIAAAAAAAAACGxhbmRsb3JkAAAAEwAAAAAAAAAFbm9uY2UAAAAAAAPuAAAAIAAAAAEAAAAT",
        "AAAAAAAAAE5GQUMtNTogc29sbyBsYSBsbGFtYSBlbCBwcm9waW8gZXNjcm93IGRlc2RlIGBmdW5kX2VzY3Jvd2AgKGludm9jYWRvciBkaXJlY3RvKS4AAAAAAA9yZWdpc3Rlcl90ZW5hbnQAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAABnRlbmFudAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAAMRmFjdG9yeUVycm9y",
        "AAAAAAAAAAAAAAAQZGVmYXVsdF9zdHJhdGVneQAAAAAAAAABAAAD6QAAB9AAAAAIU3RyYXRlZ3kAAAfQAAAADEZhY3RvcnlFcnJvcg==",
        "AAAAAAAAAAAAAAAQZXNjcm93X3dhc21faGFzaAAAAAAAAAABAAAD7gAAACA=",
        "AAAAAAAAAAAAAAAQbGlzdF9ieV9sYW5kbG9yZAAAAAMAAAAAAAAACGxhbmRsb3JkAAAAEwAAAAAAAAAFc3RhcnQAAAAAAAAEAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6QAAA+oAAAAGAAAH0AAAAAxGYWN0b3J5RXJyb3I=",
        "AAAAAAAAAAAAAAARY291bnRfYnlfbGFuZGxvcmQAAAAAAAABAAAAAAAAAAhsYW5kbG9yZAAAABMAAAABAAAABA==",
        "AAAAAAAAAHhGQUMtOTogYXTDs21pY2EgKHVuIGZhbGxvIHJldmllcnRlIHRvZG9zIGxvcyBkZXNwbGllZ3VlcykgeSBjb24gdW5hIHNvbGEgZmlybWEgZGVsCmNhc2Vyby4gTm8gcGFzYSBwb3IgZWwgUmVsYXllciAoTi0zKS4AAAAUY3JlYXRlX2ZpYW56YXNfYmF0Y2gAAAACAAAAAAAAAAhsYW5kbG9yZAAAABMAAAAAAAAABWl0ZW1zAAAAAAAD6gAAB9AAAAAMRmlhbnphUGFyYW1zAAAAAQAAA+kAAAPqAAAH0AAAAAdDcmVhdGVkAAAAB9AAAAAMRmFjdG9yeUVycm9y",
        "AAAAAAAAAAAAAAAUc2V0X2RlZmF1bHRfc3RyYXRlZ3kAAAABAAAAAAAAAAJpZAAAAAAAEQAAAAEAAAPpAAAAAgAAB9AAAAAMRmFjdG9yeUVycm9y",
        "AAAAAAAAAAAAAAAUc2V0X2VzY3Jvd193YXNtX2hhc2gAAAABAAAAAAAAAARoYXNoAAAD7gAAACAAAAABAAAD6QAAAAIAAAfQAAAADEZhY3RvcnlFcnJvcg==",
        "AAAAAAAAAAAAAAAUc2V0X3N0cmF0ZWd5X2VuYWJsZWQAAAACAAAAAAAAAAJpZAAAAAAAEQAAAAAAAAAHZW5hYmxlZAAAAAABAAAAAQAAA+kAAAACAAAH0AAAAAxGYWN0b3J5RXJyb3I=" ]),
      options
    )
  }
  public readonly fromJSON = {
    admin: this.txFromJSON<string>,
        count: this.txFromJSON<u64>,
        id_of: this.txFromJSON<Result<u64>>,
        pause: this.txFromJSON<null>,
        config: this.txFromJSON<GlobalConfig>,
        paused: this.txFromJSON<boolean>,
        unpause: this.txFromJSON<null>,
        strategy: this.txFromJSON<Result<Strategy>>,
        escrow_of: this.txFromJSON<Result<string>>,
        set_config: this.txFromJSON<Result<void>>,
        strategies: this.txFromJSON<Array<Strategy>>,
        get_fianzas: this.txFromJSON<Result<Array<FianzaSummary>>>,
        add_strategy: this.txFromJSON<Result<void>>,
        create_fianza: this.txFromJSON<Result<Created>>,
        config_version: this.txFromJSON<u32>,
        list_by_tenant: this.txFromJSON<Result<Array<u64>>>,
        count_by_tenant: this.txFromJSON<u32>,
        funding_allowed: this.txFromJSON<boolean>,
        predict_address: this.txFromJSON<string>,
        register_tenant: this.txFromJSON<Result<void>>,
        default_strategy: this.txFromJSON<Result<Strategy>>,
        escrow_wasm_hash: this.txFromJSON<Buffer>,
        list_by_landlord: this.txFromJSON<Result<Array<u64>>>,
        count_by_landlord: this.txFromJSON<u32>,
        create_fianzas_batch: this.txFromJSON<Result<Array<Created>>>,
        set_default_strategy: this.txFromJSON<Result<void>>,
        set_escrow_wasm_hash: this.txFromJSON<Result<void>>,
        set_strategy_enabled: this.txFromJSON<Result<void>>
  }
}