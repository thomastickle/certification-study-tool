import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { networkOrigin } from './network-profile.ts'
import type { NetworkProfile } from './network-profile.ts'
import { rejectLinks } from './database-files.ts'

/**
 * Replace generated configuration atomically without making private deployment details world-readable.
 * @throws {Error} For unsafe symlinked paths or failed writes; temporary files are retained for investigation.
 */
export function writePrivate(path: string, contents: string): void {
  rejectLinks(path)
  const temporary = `${path}.${randomUUID()}.new`
  writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
}

/**
 * Run installed OpenSSL without shell interpolation or printing private key material.
 * @throws {Error} If certificate creation or validation fails; existing authority files are retained.
 */
function openssl(arguments_: string[]): void {
  const result = spawnSync('openssl', arguments_, { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(
      'OpenSSL failed. Retain the private network-access directory for investigation.',
    )
  }
}

/**
 * Keep one private CA across modes and renew the hostname certificate using that same authority.
 * @throws {Error} For unsafe paths, incomplete authority material or failed OpenSSL operations; never silently replaces a CA.
 */
export function prepareCertificates(root: string, profile: NetworkProfile): void {
  networkOrigin(profile)
  rejectLinks(root)
  const authority = join(root, 'authority')
  const tls = join(root, 'tls')
  const publicDirectory = join(root, 'public')
  for (const directory of [root, authority, tls, publicDirectory]) {
    rejectLinks(directory)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
  }
  const authorityKey = join(authority, 'root.key')
  const certificate = join(publicDirectory, 'root.crt')
  for (const path of [
    authorityKey,
    certificate,
    join(tls, 'site.key'),
    join(tls, 'site.crt'),
    join(tls, 'site.csr'),
    join(tls, 'extensions.cnf'),
  ]) {
    rejectLinks(path)
  }
  if (existsSync(authorityKey) !== existsSync(certificate)) {
    throw new Error('Incomplete local CA. Recover the original authority instead of replacing it.')
  }
  if (!existsSync(authorityKey)) {
    openssl([
      'req',
      '-x509',
      '-newkey',
      'rsa:3072',
      '-nodes',
      '-sha256',
      '-days',
      '3650',
      '-subj',
      '/CN=Certification Study Tool Local CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
      '-keyout',
      authorityKey,
      '-out',
      certificate,
    ])
    chmodSync(authorityKey, 0o600)
  }
  openssl(['verify', '-CAfile', certificate, certificate])
  const siteKey = join(tls, 'site.key')
  const request = join(tls, 'site.csr')
  const extension = join(tls, 'extensions.cnf')
  writePrivate(
    extension,
    `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${profile.hostname}\n`,
  )
  openssl([
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-subj',
    `/CN=${profile.hostname}`,
    '-keyout',
    siteKey,
    '-out',
    request,
  ])
  chmodSync(siteKey, 0o600)
  openssl([
    'x509',
    '-req',
    '-in',
    request,
    '-CA',
    certificate,
    '-CAkey',
    authorityKey,
    '-set_serial',
    `0x${Date.now().toString(16)}`,
    '-days',
    '365',
    '-sha256',
    '-extfile',
    extension,
    '-out',
    join(tls, 'site.crt'),
  ])
  openssl([
    'verify',
    '-CAfile',
    certificate,
    '-verify_hostname',
    profile.hostname,
    join(tls, 'site.crt'),
  ])
  // Only the public certificate and enrollment page enter this directory's file-server mount.
  chmodSync(certificate, 0o644)
  writePrivate(join(publicDirectory, 'index.html'), enrollmentPage(profile))
}

/**
 * Present the one-time device trust steps without putting application data on the HTTP listener.
 */
function enrollmentPage(profile: NetworkProfile): string {
  const origin = networkOrigin(profile)
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Study tool · device setup</title>
<style>body{font:18px/1.6 system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem}a{color:#1757a8}h1{line-height:1.2}</style>
<h1>Open your study tool</h1>
<p>This laptop shares the same library and study history with your other devices.</p>
<ol><li><a href="/root.crt">Download the study tool certificate</a>. Only install it if you expected this setup and its SHA-256 fingerprint matches the laptop's setup output.</li>
<li>On iPhone/iPad: Settings → General → VPN &amp; Device Management → downloaded profile → Install. Then General → About → Certificate Trust Settings → enable full trust for Certification Study Tool Local CA.</li>
<li>On Android: Settings → Security &amp; privacy → More security settings → Encryption &amp; credentials → Install a certificate → CA certificate (names vary by phone).</li></ol>
<p><a href="${origin}">Open the study tool</a></p>
<p>For a desktop browser, import this same certificate as a trusted certificate authority. Keep the laptop awake and both devices on the same home network.</p>
</html>\n`
}

/**
 * Prepare a reviewable root-only hosts/trust operation; the access CLI never invokes sudo itself.
 */
export function writeHostSetup(root: string, profile: NetworkProfile): void {
  /**
   * Preserve literal filesystem paths in the generated operator command.
   */
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

  const certificate = join(root, 'public/root.crt')
  const script = `#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Run this reviewed setup script with sudo.' >&2; exit 1; }
# Refuse replacing another deployment's trusted CA.
[ ! -L /usr/local/share/ca-certificates/certification-study-tool.crt ] || { echo 'Existing trust entry is a symlink; inspect it first.' >&2; exit 1; }
if [ -f /usr/local/share/ca-certificates/certification-study-tool.crt ] && ! cmp -s ${quote(certificate)} /usr/local/share/ca-certificates/certification-study-tool.crt; then
  echo 'A different study-tool CA is already trusted. Resolve it explicitly before setup.' >&2
  exit 1
fi
# Keep the host browser on loopback in both modes; other devices use mDNS.
if awk -v name='${profile.hostname}' '{ sub(/#.*/, ""); for (field=2; field<=NF; field++) if (tolower($field)==name && $1!="127.0.0.1") conflict=1 } END { exit(conflict ? 0 : 1) }' /etc/hosts; then
  echo 'This hostname already has another hosts-file mapping. Resolve it before applying setup.' >&2
  exit 1
fi
if ! grep -Eq '^127\\.0\\.0\\.1[[:space:]]+${profile.hostname.replaceAll('.', '\\.')}([[:space:]]|$)' /etc/hosts; then
  cp -p /etc/hosts /etc/hosts.study-tool-backup-$(date +%s)
  printf '\\n127.0.0.1 ${profile.hostname} # certification-study-tool\\n' >> /etc/hosts
fi
install -m 644 ${quote(certificate)} /usr/local/share/ca-certificates/certification-study-tool.crt
update-ca-certificates
`
  writePrivate(join(root, 'host-setup.sh'), script)
}

/**
 * Refuse a local-only switch until the host browser can resolve the stable name to loopback.
 */
export function hasLocalHostname(hosts: string, hostname: string): boolean {
  const addresses = hosts.split(/\r?\n/).flatMap((line) => {
    const [address, ...names] = line.split('#')[0]!.trim().split(/\s+/)
    return names.some((name) => name.toLowerCase() === hostname) ? [address] : []
  })
  return addresses.length > 0 && addresses.every((address) => address === '127.0.0.1')
}

/**
 * Add only the generated override, preserving the existing volume selection and all private settings.
 */
export function enableNetworkCompose(environmentPath: string, files: string[]): void {
  const original = readFileSync(environmentPath, 'utf8')
  const lines = original.split(/\r?\n/).filter((line) => !/^COMPOSE_FILE=/.test(line))
  writePrivate(environmentPath, `${lines.join('\n').trimEnd()}\nCOMPOSE_FILE=${files.join(':')}\n`)
}
