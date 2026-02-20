import type {
  FormattedTransactionResponse,
} from 'evmdecoder/lib/index'
import type {
  FormattedLogEvent,
  FormattedTransaction,
} from 'evmdecoder/lib/msgs'
import type { RawTransaction } from 'evmdecoder/lib/eth/responses'

export type DecodedTransaction = FormattedTransactionResponse
export type DecodedLogEvent = FormattedLogEvent

export type PersistableDecodedTransaction = FormattedTransactionResponse & {
  transaction: FormattedTransaction & {
    status: 'success'
    to: string
    blockHash: string
    blockNumber: number
    transactionIndex: number
    timestamp: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFormattedTransaction(value: unknown): value is FormattedTransaction {
  if (!isRecord(value)) return false
  return typeof value['hash'] === 'string'
    && typeof value['from'] === 'string'
    && 'status' in value
}

export function isFormattedTransactionResponse(
  value: RawTransaction | FormattedTransactionResponse,
): value is FormattedTransactionResponse {
  if (!isRecord(value)) return false
  return isFormattedTransaction(value['transaction']) && Array.isArray(value['logEvents'])
}

export function isPersistableDecodedTransaction(
  value: RawTransaction | FormattedTransactionResponse,
): value is PersistableDecodedTransaction {
  if (!isFormattedTransactionResponse(value)) return false

  const tx = value.transaction
  return tx.status === 'success'
    && typeof tx.to === 'string'
    && typeof tx.blockHash === 'string'
    && typeof tx.blockNumber === 'number'
    && typeof tx.transactionIndex === 'number'
    && typeof tx.timestamp === 'number'
}
