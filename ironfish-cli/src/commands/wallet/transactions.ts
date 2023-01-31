/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { Asset, ASSET_NAME_LENGTH } from '@ironfish/rust-nodejs'
import {
  Assert,
  BufferUtils,
  CurrencyUtils,
  GetAccountTransactionsResponse,
  PartialRecursive,
  TransactionType,
} from '@ironfish/sdk'
import { CliUx, Flags } from '@oclif/core'
import { IronfishCommand } from '../../command'
import { RemoteFlags } from '../../flags'
import { TableCols, truncateCol } from '../../utils/table'

const MAX_ASSET_NAME_COLUMN_WIDTH = ASSET_NAME_LENGTH + 1
const MIN_ASSET_NAME_COLUMN_WIDTH = 'Asset Name'.length + 1

export class TransactionsCommand extends IronfishCommand {
  static description = `Display the account transactions`

  static flags = {
    ...RemoteFlags,
    ...CliUx.ux.table.flags(),
    hash: Flags.string({
      char: 't',
      description: 'Transaction hash to get details for',
    }),
    limit: Flags.integer({
      description: 'Number of latest transactions to get details for',
    }),
    confirmations: Flags.integer({
      description: 'Number of block confirmations needed to confirm a transaction',
    }),
  }

  static args = [
    {
      name: 'account',
      parse: (input: string): Promise<string> => Promise.resolve(input.trim()),
      required: false,
      description: 'Name of the account',
    },
  ]

  async start(): Promise<void> {
    const { flags, args } = await this.parse(TransactionsCommand)
    const account = args.account as string | undefined

    const client = await this.sdk.connectRpc()
    const response = client.getAccountTransactionsStream({
      account,
      hash: flags.hash,
      limit: flags.limit,
      confirmations: flags.confirmations,
    })

    let showHeader = true
    const assetNameWidth = flags.extended
      ? MAX_ASSET_NAME_COLUMN_WIDTH
      : MIN_ASSET_NAME_COLUMN_WIDTH

    for await (const transaction of response.contentStream()) {
      const transactionHeader = this.getTransactionHeader(transaction)

      const isGroup = transaction.assetBalanceDeltas.length > 1

      if (isGroup) {
        transactionHeader.group = '┏'
      }

      const transactionRows: PartialRecursive<TransactionRow>[] = []
      for (const { assetId, assetName, delta } of transaction.assetBalanceDeltas) {
        if (assetId === Asset.nativeId().toString('hex')) {
          continue
        }

        let group = ''

        if (isGroup) {
          if (transactionRows.length === transaction.assetBalanceDeltas.length - 2) {
            group = '┗'
          } else {
            group = '┣'
          }
        }

        transactionRows.push({
          group,
          assetId,
          assetName: BufferUtils.toHuman(Buffer.from(assetName, 'hex')),
          amount: BigInt(delta),
        })
      }

      let columns: CliUx.Table.table.Columns<TransactionRow> = {
        group: {
          header: '',
          minWidth: 3,
        },
        timestamp: TableCols.timestamp({
          streaming: true,
        }),
        status: {
          header: 'Status',
          minWidth: 12,
        },
        type: {
          header: 'Type',
          minWidth: 8,
        },
        hash: {
          header: 'Hash',
          minWidth: 32,
        },
        notesCount: {
          header: 'Notes',
          minWidth: 5,
          extended: true,
        },
        spendsCount: {
          header: 'Spends',
          minWidth: 5,
          extended: true,
        },
        mintsCount: {
          header: 'Mints',
          minWidth: 5,
          extended: true,
        },
        burnsCount: {
          header: 'Burns',
          minWidth: 5,
          extended: true,
        },
        expiration: {
          header: 'Expiration',
        },
        feePaid: {
          header: 'Fee Paid ($IRON)',
          get: (row) =>
            row.feePaid && row.feePaid !== 0n ? CurrencyUtils.renderIron(row.feePaid) : '',
        },
      }

      if (flags.extended) {
        columns = {
          ...columns,
          assetId: {
            header: 'Asset ID',
            extended: true,
          },
          assetName: {
            header: 'Asset Name',
            get: (row) => {
              Assert.isNotUndefined(row.assetName)
              return truncateCol(row.assetName, assetNameWidth)
            },
            minWidth: assetNameWidth,
            extended: true,
          },
        }
      } else {
        columns = {
          ...columns,
          asset: {
            header: 'Asset',
            get: (row) => {
              Assert.isNotUndefined(row.assetName)
              Assert.isNotUndefined(row.assetId)
              const text = row.assetName.padEnd(assetNameWidth, ' ')
              return `${text} (${row.assetId.slice(0, 5)})`
            },
            extended: false,
            minWidth: assetNameWidth,
          },
        }
      }

      columns = {
        ...columns,
        amount: {
          header: 'Net Amount',
          get: (row) => {
            Assert.isNotUndefined(row.amount)
            return row.amount !== 0n ? CurrencyUtils.renderIron(row.amount) : ''
          },
          minWidth: 16,
        },
      }

      CliUx.ux.table([transactionHeader, ...transactionRows], columns, {
        printLine: this.log.bind(this),
        ...flags,
        'no-header': !showHeader,
      })

      showHeader = false
    }
  }

  getTransactionHeader(transaction: GetAccountTransactionsResponse): TransactionRow {
    const assetId = Asset.nativeId().toString('hex')

    const nativeAssetBalanceDelta = transaction.assetBalanceDeltas.find(
      (d) => d.assetId === assetId,
    )

    let amount = BigInt(nativeAssetBalanceDelta?.delta ?? '0')

    let feePaid = BigInt(transaction.fee)

    if (transaction.type !== TransactionType.SEND) {
      feePaid = 0n
    } else {
      amount += feePaid
    }

    return {
      ...transaction,
      group: '',
      assetId,
      assetName: '$IRON',
      amount,
      feePaid,
    }
  }
}

type TransactionRow = {
  group: string
  timestamp: number
  status: string
  type: string
  hash: string
  assetId: string
  assetName: string
  amount: bigint
  feePaid?: bigint
  notesCount: number
  spendsCount: number
  mintsCount: number
  burnsCount: number
  expiration: number
}
