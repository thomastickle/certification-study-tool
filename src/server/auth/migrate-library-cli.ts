import { parseArgs } from 'node:util'
import { migrateLibrary, migrationAccounts } from './migrate-library.ts'

try {
  const options = {
    'data-dir': { type: 'string' },
    'account-id': { type: 'string' },
    source: { type: 'string' },
    'list-accounts': { type: 'boolean' },
    apply: { type: 'boolean', default: false },
    help: { type: 'boolean' },
  } as const
  const { values } = parseArgs({ options })
  if (values.help) {
    console.log(
      'npm run migrate:library -- --data-dir <directory> --list-accounts\nnpm run migrate:library -- --data-dir <directory> --account-id <id> [--source <legacy-db>] [--apply]',
    )
  } else {
    if (!values['data-dir']) {
      throw new Error('An explicit --data-dir is required.')
    }
    if (values['list-accounts']) {
      if (values.apply || values['account-id'] || values.source) {
        throw new Error('Use --list-accounts by itself with --data-dir.')
      }
      const accounts = migrationAccounts(values['data-dir'])
      console.log(JSON.stringify(accounts, null, 2))
    } else {
      if (!values['account-id']) {
        throw new Error('Choose an existing --account-id from --list-accounts.')
      }
      const migrationOptions = {
        dataDirectory: values['data-dir'],
        accountId: values['account-id'],
        source: values.source,
        apply: values.apply,
      }
      const result = await migrateLibrary(migrationOptions)
      console.log(JSON.stringify(result, null, 2))
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Migration failed.')
  process.exitCode = 1
}
