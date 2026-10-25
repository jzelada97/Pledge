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




export const MockVaultError = {
  1: {message:"AmountNotAllowed"},
  2: {message:"InsufficientReserve"},
  3: {message:"VaultError"},
  4: {message:"InsufficientShares"},
  5: {message:"NotAdmin"},
  6: {message:"WrongAmountsLength"},
  7: {message:"BelowMin"}
}


/**
 * Asignaciones que devuelve `deposit` de DeFindex (tercer elemento del retorno).
 */
export interface StrategyAllocation {
  amount: i128;
  paused: boolean;
  strategy_address: string;
}


export interface AssetInvestmentAllocation {
  asset: string;
  strategy_allocations: Array<Option<StrategyAllocation>>;
}

export interface Client {
  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  symbol: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  balance: ({id}: {id: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Igual que DeFindex: `(amounts_depositados, shares_emitidas, allocations)`, comprobado
   * simulando `deposit` contra el vault propio de testnet. El mock devuelve `None` en las
   * asignaciones porque no tiene estrategias. El escrow ignora el retorno y mide las shares con
   * `balance(escrow)` antes y después.
   * La tupla va en línea: un alias de tipo no entra en la spec del contrato y rompe los bindings.
   */
  deposit: ({amounts_desired, amounts_min, from, invest}: {amounts_desired: Array<i128>, amounts_min: Array<i128>, from: string, invest: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<readonly [Array<i128>, i128, Option<Array<AssetInvestmentAllocation>>]>>>

  /**
   * Construct and simulate a get_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fees: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [u32, u32]>>

  /**
   * Construct and simulate a set_fail transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Con `true`, deposit y withdraw fallan con VaultError (para probar el manejo de errores del escrow).
   */
  set_fail: ({fail}: {fail: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cambia las comisiones que devuelve `get_fees` (para probar VaultFeeChanged en el escrow).
   */
  set_fees: ({vault_fee_bps, protocol_fee_bps}: {vault_fee_bps: u32, protocol_fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Igual que DeFindex: devuelve los importes pagados por activo. Paga desde la reserva real del token;
   * si no alcanza (pérdida simulada mayor que la reserva o reserva vaciada en tests) → InsufficientReserve.
   */
  withdraw: ({withdraw_shares, min_amounts_out, from}: {withdraw_shares: i128, min_amounts_out: Array<i128>, from: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<i128>>>>

  /**
   * Construct and simulate a get_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_assets: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_manager transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_manager: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a set_rate_bps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Tasa anual simulada en bps. Negativa = pérdida. Aplica el accrue pendiente antes de cambiarla.
   */
  set_rate_bps: ({rate_bps}: {rate_bps: i32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a total_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a drain_reserve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Saca tokens de la reserva (simula iliquidez: el siguiente withdraw dará InsufficientReserve).
   */
  drain_reserve: ({to, amount}: {to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_total_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Fija el valor contable total (simula un salto de ganancia o pérdida sin esperar al reloj).
   */
  set_total_assets: ({total_assets}: {total_assets: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_asset_amounts_per_shares transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Valor actual (con el rendimiento simulado hasta ahora) de `vault_shares`, por activo.
   */
  get_asset_amounts_per_shares: ({vault_shares}: {vault_shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<i128>>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, asset}: {admin: string, asset: string},
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
    return ContractClient.deploy({admin, asset}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAADk1vY2tWYXVsdEVycm9yAAAAAAAHAAAAAAAAABBBbW91bnROb3RBbGxvd2VkAAAAAQAAAAAAAAATSW5zdWZmaWNpZW50UmVzZXJ2ZQAAAAACAAAAAAAAAApWYXVsdEVycm9yAAAAAAADAAAAAAAAABJJbnN1ZmZpY2llbnRTaGFyZXMAAAAAAAQAAAAAAAAACE5vdEFkbWluAAAABQAAAAAAAAASV3JvbmdBbW91bnRzTGVuZ3RoAAAAAAAGAAAAAAAAAAhCZWxvd01pbgAAAAc=",
        "AAAAAQAAAE5Bc2lnbmFjaW9uZXMgcXVlIGRldnVlbHZlIGBkZXBvc2l0YCBkZSBEZUZpbmRleCAodGVyY2VyIGVsZW1lbnRvIGRlbCByZXRvcm5vKS4AAAAAAAAAAAASU3RyYXRlZ3lBbGxvY2F0aW9uAAAAAAADAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAAAAAAQc3RyYXRlZ3lfYWRkcmVzcwAAABM=",
        "AAAAAQAAAAAAAAAAAAAAGUFzc2V0SW52ZXN0bWVudEFsbG9jYXRpb24AAAAAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAFHN0cmF0ZWd5X2FsbG9jYXRpb25zAAAD6gAAA+gAAAfQAAAAElN0cmF0ZWd5QWxsb2NhdGlvbgAA",
        "AAAAAAAAAAAAAAAEbmFtZQAAAAAAAAABAAAAEA==",
        "AAAAAAAAAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAHYmFsYW5jZQAAAAABAAAAAAAAAAJpZAAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAYpJZ3VhbCBxdWUgRGVGaW5kZXg6IGAoYW1vdW50c19kZXBvc2l0YWRvcywgc2hhcmVzX2VtaXRpZGFzLCBhbGxvY2F0aW9ucylgLCBjb21wcm9iYWRvCnNpbXVsYW5kbyBgZGVwb3NpdGAgY29udHJhIGVsIHZhdWx0IHByb3BpbyBkZSB0ZXN0bmV0LiBFbCBtb2NrIGRldnVlbHZlIGBOb25lYCBlbiBsYXMKYXNpZ25hY2lvbmVzIHBvcnF1ZSBubyB0aWVuZSBlc3RyYXRlZ2lhcy4gRWwgZXNjcm93IGlnbm9yYSBlbCByZXRvcm5vIHkgbWlkZSBsYXMgc2hhcmVzIGNvbgpgYmFsYW5jZShlc2Nyb3cpYCBhbnRlcyB5IGRlc3B1w6lzLgpMYSB0dXBsYSB2YSBlbiBsw61uZWE6IHVuIGFsaWFzIGRlIHRpcG8gbm8gZW50cmEgZW4gbGEgc3BlYyBkZWwgY29udHJhdG8geSByb21wZSBsb3MgYmluZGluZ3MuAAAAAAAHZGVwb3NpdAAAAAAEAAAAAAAAAA9hbW91bnRzX2Rlc2lyZWQAAAAD6gAAAAsAAAAAAAAAC2Ftb3VudHNfbWluAAAAA+oAAAALAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGaW52ZXN0AAAAAAABAAAAAQAAA+kAAAPtAAAAAwAAA+oAAAALAAAACwAAA+gAAAPqAAAH0AAAABlBc3NldEludmVzdG1lbnRBbGxvY2F0aW9uAAAAAAAH0AAAAA5Nb2NrVmF1bHRFcnJvcgAA",
        "AAAAAAAAAAAAAAAIZ2V0X2ZlZXMAAAAAAAAAAQAAA+0AAAACAAAABAAAAAQ=",
        "AAAAAAAAAGNDb24gYHRydWVgLCBkZXBvc2l0IHkgd2l0aGRyYXcgZmFsbGFuIGNvbiBWYXVsdEVycm9yIChwYXJhIHByb2JhciBlbCBtYW5lam8gZGUgZXJyb3JlcyBkZWwgZXNjcm93KS4AAAAACHNldF9mYWlsAAAAAQAAAAAAAAAEZmFpbAAAAAEAAAAA",
        "AAAAAAAAAFlDYW1iaWEgbGFzIGNvbWlzaW9uZXMgcXVlIGRldnVlbHZlIGBnZXRfZmVlc2AgKHBhcmEgcHJvYmFyIFZhdWx0RmVlQ2hhbmdlZCBlbiBlbCBlc2Nyb3cpLgAAAAAAAAhzZXRfZmVlcwAAAAIAAAAAAAAADXZhdWx0X2ZlZV9icHMAAAAAAAAEAAAAAAAAABBwcm90b2NvbF9mZWVfYnBzAAAABAAAAAA=",
        "AAAAAAAAAM5JZ3VhbCBxdWUgRGVGaW5kZXg6IGRldnVlbHZlIGxvcyBpbXBvcnRlcyBwYWdhZG9zIHBvciBhY3Rpdm8uIFBhZ2EgZGVzZGUgbGEgcmVzZXJ2YSByZWFsIGRlbCB0b2tlbjsKc2kgbm8gYWxjYW56YSAocMOpcmRpZGEgc2ltdWxhZGEgbWF5b3IgcXVlIGxhIHJlc2VydmEgbyByZXNlcnZhIHZhY2lhZGEgZW4gdGVzdHMpIOKGkiBJbnN1ZmZpY2llbnRSZXNlcnZlLgAAAAAACHdpdGhkcmF3AAAAAwAAAAAAAAAPd2l0aGRyYXdfc2hhcmVzAAAAAAsAAAAAAAAAD21pbl9hbW91bnRzX291dAAAAAPqAAAACwAAAAAAAAAEZnJvbQAAABMAAAABAAAD6QAAA+oAAAALAAAH0AAAAA5Nb2NrVmF1bHRFcnJvcgAA",
        "AAAAAAAAAAAAAAAKZ2V0X2Fzc2V0cwAAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAAAAAAALZ2V0X21hbmFnZXIAAAAAAAAAAAEAAAPpAAAAEwAAB9AAAAAOTW9ja1ZhdWx0RXJyb3IAAA==",
        "AAAAAAAAAF9UYXNhIGFudWFsIHNpbXVsYWRhIGVuIGJwcy4gTmVnYXRpdmEgPSBww6lyZGlkYS4gQXBsaWNhIGVsIGFjY3J1ZSBwZW5kaWVudGUgYW50ZXMgZGUgY2FtYmlhcmxhLgAAAAAMc2V0X3JhdGVfYnBzAAAAAQAAAAAAAAAIcmF0ZV9icHMAAAAFAAAAAA==",
        "AAAAAAAAAAAAAAAMdG90YWxfc3VwcGx5AAAAAAAAAAEAAAAL",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAA==",
        "AAAAAAAAAF5TYWNhIHRva2VucyBkZSBsYSByZXNlcnZhIChzaW11bGEgaWxpcXVpZGV6OiBlbCBzaWd1aWVudGUgd2l0aGRyYXcgZGFyw6EgSW5zdWZmaWNpZW50UmVzZXJ2ZSkuAAAAAAANZHJhaW5fcmVzZXJ2ZQAAAAAAAAIAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAADk1vY2tWYXVsdEVycm9yAAA=",
        "AAAAAAAAAFtGaWphIGVsIHZhbG9yIGNvbnRhYmxlIHRvdGFsIChzaW11bGEgdW4gc2FsdG8gZGUgZ2FuYW5jaWEgbyBww6lyZGlkYSBzaW4gZXNwZXJhciBhbCByZWxvaikuAAAAABBzZXRfdG90YWxfYXNzZXRzAAAAAQAAAAAAAAAMdG90YWxfYXNzZXRzAAAACwAAAAEAAAPpAAAAAgAAB9AAAAAOTW9ja1ZhdWx0RXJyb3IAAA==",
        "AAAAAAAAAFVWYWxvciBhY3R1YWwgKGNvbiBlbCByZW5kaW1pZW50byBzaW11bGFkbyBoYXN0YSBhaG9yYSkgZGUgYHZhdWx0X3NoYXJlc2AsIHBvciBhY3Rpdm8uAAAAAAAAHGdldF9hc3NldF9hbW91bnRzX3Blcl9zaGFyZXMAAAABAAAAAAAAAAx2YXVsdF9zaGFyZXMAAAALAAAAAQAAA+kAAAPqAAAACwAAB9AAAAAOTW9ja1ZhdWx0RXJyb3IAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    name: this.txFromJSON<string>,
        symbol: this.txFromJSON<string>,
        balance: this.txFromJSON<i128>,
        deposit: this.txFromJSON<Result<readonly [Array<i128>, i128, Option<Array<AssetInvestmentAllocation>>]>>,
        get_fees: this.txFromJSON<readonly [u32, u32]>,
        set_fail: this.txFromJSON<null>,
        set_fees: this.txFromJSON<null>,
        withdraw: this.txFromJSON<Result<Array<i128>>>,
        get_assets: this.txFromJSON<Array<string>>,
        get_manager: this.txFromJSON<Result<string>>,
        set_rate_bps: this.txFromJSON<null>,
        total_supply: this.txFromJSON<i128>,
        drain_reserve: this.txFromJSON<Result<void>>,
        set_total_assets: this.txFromJSON<Result<void>>,
        get_asset_amounts_per_shares: this.txFromJSON<Result<Array<i128>>>
  }
}