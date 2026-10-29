import { lstatSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Reject hidden entries, links and special files before publishing or serving an immutable tree.
 * @throws {Error} For unsafe assets or an unreadable distribution directory.
 */
export function validateStaticAssets(root: string): void {
  const selected = resolve(root)
  const directory = lstatSync(selected)
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new Error('Unsafe static asset: distribution root must be a real directory.')
  }
  inspect(selected)
}

/** Never follow a link, including links whose targets happen to remain inside the root. */
function inspect(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const ordinary = entry.isDirectory() || entry.isFile()
    if (entry.name.startsWith('.') || !ordinary) {
      throw new Error('Unsafe static asset: hidden entries, links and special files are forbidden.')
    }
    if (entry.isDirectory()) {
      inspect(join(directory, entry.name))
    }
  }
}
