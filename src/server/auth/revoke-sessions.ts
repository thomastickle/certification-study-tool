import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { AccountRepository } from './account-repository.ts'

try {
  const { values } = parseArgs({
    options: {
      accounts: { type: 'string' },
      issuer: { type: 'string' },
      subject: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log(
      'npm run auth:revoke -- --accounts <database> --issuer <exact-issuer> --subject <user-ID>',
    )
  } else {
    if (!values.accounts || !values.issuer || !values.subject?.trim()) {
      throw new Error('Explicit --accounts, --issuer and --subject values are required.')
    }
    const path = resolve(values.accounts)
    if (!existsSync(path)) {
      throw new Error('The account database does not exist. No sessions were changed.')
    }
    const accounts = new AccountRepository(path)
    try {
      const account = accounts.findIdentity(values.issuer, values.subject)
      if (!account) {
        throw new Error('No account matches that issuer and subject. No sessions were changed.')
      }
      accounts.revokeAccountSessions(account.id)
      console.log('Application sessions revoked for the selected account.')
    } finally {
      accounts.close()
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Sessions could not be revoked.')
  process.exitCode = 1
}
