import { isIP } from 'node:net'

export type AccessMode = 'local' | 'lan'

export type NetworkProfile = {
  hostname: string
  address: string
  httpsPort: number
  enrollmentPort: number
  webPort: number
  keycloakPort: number
}

/**
 * Keep browser and provider identity stable while changing only published listeners.
 */
export function publishedPorts(mode: AccessMode, profile: NetworkProfile): string[] {
  validateProfile(profile)
  const ports = [
    `127.0.0.1:${profile.webPort}:3000`,
    `127.0.0.1:${profile.keycloakPort}:${profile.keycloakPort}`,
    `127.0.0.1:${profile.httpsPort}:${profile.httpsPort}`,
    `127.0.0.1:${profile.enrollmentPort}:${profile.enrollmentPort}`,
  ]
  if (mode === 'lan') {
    ports.push(
      `${profile.address}:${profile.httpsPort}:${profile.httpsPort}`,
      `${profile.address}:${profile.enrollmentPort}:${profile.enrollmentPort}`,
    )
  }
  return ports
}

/**
 * Refuse wildcard/public listeners and values that could change generated proxy configuration.
 * @throws {Error} For invalid local names, nonprivate IPv4 addresses or conflicting ports.
 */
export function validateProfile(profile: NetworkProfile): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/.test(profile.hostname)) {
    throw new Error('Choose one lowercase .local name, such as study-laptop.local.')
  }
  const [first, second] = profile.address.split('.').map(Number)
  const privateAddress =
    first === 10 ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168)
  if (isIP(profile.address) !== 4 || !privateAddress) {
    throw new Error(
      'LAN access requires a private IPv4 address, never a wildcard or public address.',
    )
  }
  const ports = [profile.httpsPort, profile.enrollmentPort, profile.webPort, profile.keycloakPort]
  if (
    ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535) ||
    new Set(ports).size !== ports.length
  ) {
    throw new Error('Use four distinct unprivileged ports.')
  }
}

/**
 * Use the same origin in both modes so cookies, verified subjects and account IDs remain stable.
 */
export function networkOrigin(profile: NetworkProfile): string {
  validateProfile(profile)
  return `https://${profile.hostname}:${profile.httpsPort}`
}

export type NetworkPaths = {
  root: string
  proxyConfiguration: string
  image: string
  user?: string
}

/**
 * Override publication without exposing raw application, identity or management ports to the LAN.
 */
export function renderNetworkCompose(
  mode: AccessMode,
  profile: NetworkProfile,
  paths: NetworkPaths,
): string {
  const origin = networkOrigin(profile)
  const proxyUser = paths.user ?? '1000:1000'
  const [userId, groupId] = proxyUser.split(':')
  const quote = JSON.stringify
  const ports = publishedPorts(mode, profile)
    .map((port) => `      - ${quote(port)}`)
    .join('\n')
  return `services:
  keycloak:
    ports: !override
${ports}
    networks:
      default:
        aliases: [${quote(profile.hostname)}]
    environment:
      KC_HOSTNAME: ${quote(origin)}
      KC_HOSTNAME_ADMIN: ${quote(`http://127.0.0.1:${profile.keycloakPort}`)}
      KC_PROXY_HEADERS: xforwarded
      KC_PROXY_TRUSTED_ADDRESSES: 127.0.0.1
      STUDY_WEB_ORIGIN: ${quote(origin)}
  study:
    depends_on:
      proxy:
        condition: service_started
    environment:
      STUDY_ORIGIN: ${quote(origin)}
      STUDY_OIDC_ISSUER: ${quote(`${origin}/realms/study`)}
      NODE_EXTRA_CA_CERTS: /trust/root.crt
    volumes:
      - type: bind
        source: ${quote(`${paths.root}/public/root.crt`)}
        target: /trust/root.crt
        read_only: true
  proxy:
    image: ${quote(paths.image)}
    user: ${quote(proxyUser)}
    network_mode: service:keycloak
    depends_on:
      keycloak:
        condition: service_started
    environment:
      STUDY_HTTPS_HOST: ${quote(profile.hostname)}
      STUDY_HTTPS_PORT: ${quote(String(profile.httpsPort))}
      STUDY_CERTIFICATE_PORT: ${quote(String(profile.enrollmentPort))}
      STUDY_KEYCLOAK_PORT: ${quote(String(profile.keycloakPort))}
    volumes:
      - type: bind
        source: ${quote(paths.proxyConfiguration)}
        target: /etc/caddy/Caddyfile
        read_only: true
      - type: bind
        source: ${quote(`${paths.root}/tls`)}
        target: /certificates
        read_only: true
      - type: bind
        source: ${quote(`${paths.root}/public`)}
        target: /public
        read_only: true
    read_only: true
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt: [no-new-privileges:true]
    tmpfs:
      - ${quote(`/data:uid=${userId},gid=${groupId},mode=0700`)}
      - ${quote(`/config:uid=${userId},gid=${groupId},mode=0700`)}
    restart: unless-stopped
    init: true
`
}
