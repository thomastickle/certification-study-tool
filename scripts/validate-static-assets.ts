import { validateStaticAssets } from '../src/server/web/validate-static-assets.ts'

// Release artifacts must satisfy the same distribution policy as production startup.
validateStaticAssets(process.argv[2] ?? 'dist')
