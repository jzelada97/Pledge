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




export const EscrowError = {
  1: {message:"BadStatus"},
  2: {message:"NotParty"},
  3: {message:"AlreadyApproved"},
  4: {message:"TimeoutNotReached"},
  5: {message:"InvalidBps"},
  6: {message:"InvalidAmount"},
  7: {message:"DeductionTooHigh"},
  8: {message:"VaultError"},
  9: {message:"InvalidInvite"},
  10: {message:"DeadlinePassed"},
  11: {message:"SameParty"},
  12: {message:"InvalidEndTs"},
  13: {message:"ReportMissing"},
  14: {message:"InvalidParty"},
  15: {message:"IncoherentResolution"},
  16: {message:"InsufficientBond"},
  17: {message:"TermsMismatch"},
  18: {message:"NotResolver"},
  19: {message:"ReviewTimeoutNotReached"},
  20: {message:"ReviewDeadlinePassed"},
  21: {message:"Paused"},
  22: {message:"Arithmetic"},
  23: {message:"InvalidConfig"},
  24: {message:"FactoryCall"},
  25: {message:"VaultFeeChanged"}
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


export interface EscrowInit {
  invite_hash: Option<Buffer>;
  tenant: Option<string>;
  terms: Terms;
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
   * Construct and simulate a cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_terms transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_terms: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Terms>>>

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_escrow: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Escrow>>>

  /**
   * Construct and simulate a fund_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  fund_escrow: ({tenant, invite_code, expected_terms}: {tenant: string, invite_code: Option<Buffer>, expected_terms: Terms}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a extend_contract_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  extend_contract_ttl: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {init}: {init: EscrowInit},
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
    return ContractClient.deploy({init}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "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",
        "AAAAAQAAAAAAAAAAAAAACkVzY3Jvd0luaXQAAAAAAAMAAAAAAAAAC2ludml0ZV9oYXNoAAAAA+gAAAPuAAAAIAAAAAAAAAAGdGVuYW50AAAAAAPoAAAAEwAAAAAAAAAFdGVybXMAAAAAAAfQAAAABVRlcm1zAAAA",
        "AAAAAQAAAAAAAAAAAAAAClNldHRsZW1lbnQAAAAAAAcAAAAAAAAACWRlZHVjdGlvbgAAAAAAAAsAAAAAAAAAC3RvX2xhbmRsb3JkAAAAAAsAAAAAAAAACXRvX3RlbmFudAAAAAAAAAsAAAAAAAAAC3RvX3RyZWFzdXJ5AAAAAAsAAAAAAAAABXRvX3R3AAAAAAAACwAAAAAAAAAFdG90YWwAAAAAAAALAAAAAAAAAAt5aWVsZF90b3RhbAAAAAAL",
        "AAAAAgAAAAAAAAAAAAAAClNldHRsZVBhdGgAAAAAAAUAAAAAAAAAAAAAAAdQZW5kaW5nAAAAAAAAAAAAAAAACEFwcHJvdmVkAAAAAAAAAAAAAAAIUmVzb2x2ZWQAAAAAAAAAAAAAAAdUaW1lb3V0AAAAAAAAAAAAAAAADVJldmlld1RpbWVvdXQAAAA=",
        "AAAAAgAAAAAAAAAAAAAADFN0cmF0ZWd5S2luZAAAAAIAAAAAAAAAAAAAAAdOb1lpZWxkAAAAAAAAAAAAAAAADURlRmluZGV4VmF1bHQAAAA=",
        "AAAAAAAAAAAAAAAGY2FuY2VsAAAAAAAAAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=",
        "AAAAAAAAAAAAAAAJZ2V0X3Rlcm1zAAAAAAAAAAAAAAEAAAPpAAAH0AAAAAVUZXJtcwAAAAAAB9AAAAALRXNjcm93RXJyb3IA",
        "AAAAAAAAAAAAAAAKZ2V0X2VzY3JvdwAAAAAAAAAAAAEAAAPpAAAH0AAAAAZFc2Nyb3cAAAAAB9AAAAALRXNjcm93RXJyb3IA",
        "AAAAAAAAAAAAAAALZnVuZF9lc2Nyb3cAAAAAAwAAAAAAAAAGdGVuYW50AAAAAAATAAAAAAAAAAtpbnZpdGVfY29kZQAAAAPoAAAD7gAAACAAAAAAAAAADmV4cGVjdGVkX3Rlcm1zAAAAAAfQAAAABVRlcm1zAAAAAAAAAQAAA+kAAAALAAAH0AAAAAtFc2Nyb3dFcnJvcgA=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAABGluaXQAAAfQAAAACkVzY3Jvd0luaXQAAAAAAAA=",
        "AAAAAAAAAAAAAAATZXh0ZW5kX2NvbnRyYWN0X3R0bAAAAAAAAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    cancel: this.txFromJSON<Result<void>>,
        get_terms: this.txFromJSON<Result<Terms>>,
        get_escrow: this.txFromJSON<Result<Escrow>>,
        fund_escrow: this.txFromJSON<Result<i128>>,
        extend_contract_ttl: this.txFromJSON<null>
  }
}