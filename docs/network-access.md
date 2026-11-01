# Local-only and home-network access

One running laptop/server owns the existing library and personal workspaces.
Your phone, desktop and laptop browsers connect to that same server; this is not
synchronization between separate SQLite installations. Keep the hosting machine
awake. There is no router port forwarding or public hosting in this setup.

The Linux host needs its existing Docker Compose, OpenSSL, `ip`, and Avahi
`avahi-publish-address` tools. No system service or firewall setting is installed
by the access commands. Docker Compose must support `!override` (2.24.4 or later).
Use Node 24 as specified by the project.

## Initial setup

Prepare the existing installation and enroll the local administrator as documented
in [authentication](authentication.md). Preserve its current `.env` and data
volumes. This helper supports the documented local Keycloak realm and a named
`/data` volume, not an unrelated external identity provider or an empty deployment.

Load the pinned proxy image once, then prepare the HTTPS profile. Choose a unique
lowercase `.local` name; do not use the host's ordinary mDNS name if Docker/VM
interfaces cause it to advertise an unrelated address.

```sh
docker pull caddy@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e
npm run access:setup -- --hostname study-laptop.local
# For multiple network cards, choose the physical home-network address explicitly:
# npm run access:setup -- --hostname study-laptop.local --address 192.168.1.125
```

Setup first validates the current Compose volume selection, generates a private
local CA and hostname certificate, and stops the application's writers. It makes
a verified central-database backup, then changes only the existing local realm's
issuer URL while preserving internal account IDs, verified subjects, private
filenames and study history. Existing app sessions are revoked once at this
initial transition. It never merges colliding accounts or creates a new library.
The same Keycloak volume, users, roles and client are retained. Exact HTTPS
callback/logout entries are added without removing existing client entries.

The command initially enables **LAN mode**. It prints the HTTPS URL, a certificate
setup page on the selected LAN address, the public CA's SHA-256 fingerprint and a
one-time laptop setup command. Before running that root-only command, inspect
`private/network-access/host-setup.sh`. It adds a loopback hosts entry for the
chosen name and trusts this project's public CA using the host's existing trust
store tools. Conflicting existing hosts entries are refused. It does not receive
or print an administrator password; run `sudo` yourself:

```sh
sudo sh private/network-access/host-setup.sh
```

The hosts entry lets the hosting machine use exactly the same HTTPS name when the
LAN listener is disabled. Other devices discover the dedicated `.local` name
through Avahi, which advertises only the selected home address rather than Docker
bridge addresses. Hosts that cannot resolve `.local` names need a corresponding
router/local-DNS entry; changing the URL to an IP will not match the configured
origin or certificate.

## Android and desktop enrollment

On your phone, join the same home Wi-Fi and open the printed **Phone setup** URL.
This HTTP page contains only the public certificate and installation instructions;
it never serves the application, login forms, private keys or question banks.
Check the downloaded certificate's fingerprint against `npm run access:status`
on your trusted laptop before installing it.

On Android, use **Settings → Security & privacy → More security settings →
Encryption & credentials → Install a certificate → CA certificate**, then select
`root.crt`. The exact labels vary by manufacturer/version. This is a **CA
certificate**, not a Wi-Fi or VPN client certificate. See Google's
[certificate instructions](https://support.google.com/pixelphone/answer/2844832).
Then open the printed HTTPS study URL and sign in normally. Android may show a
persistent notice that a user CA is installed. Remove this specific CA from User
trusted credentials when you stop using it; do not clear all device credentials.

Desktop/laptop clients need the same public CA trusted by their browser/OS. On
Linux, the supplied host-setup command also configures the local trust store;
browsers with a separate trust store may require importing `root.crt` explicitly.
Only transfer `public/root.crt`. Never transfer `authority/root.key` or
`tls/site.key` to another client device.

## Switching modes

```sh
npm run access:local    # loopback listeners only; other devices cannot connect
npm run access:lan      # additionally bind HTTPS and certificate setup to the chosen LAN IP
npm run access:status   # configured mode, URLs, CA fingerprint and Docker status
```

Both modes use the same HTTPS name, certificate authority, issuer, accounts and
volumes. Switching stops/recreates the shared Docker network namespace and can
interrupt active browser requests; save or pause practice first. Mode switching
does not rewrite accounts or revoke sessions. The raw app and Keycloak ports
remain on loopback. The proxy publishes only HTTPS 3443 and public-certificate
setup HTTP 3080 on the explicitly selected private address; it rejects requests
from public IP ranges and does not proxy Keycloak administration/master-realm
paths. The administrator console remains local on the original Keycloak port.
The proxy runs non-root and read-only with no-new-privileges; NET_BIND_SERVICE
remains in its capability bounding set because the official binary carries that
file capability, even though these listeners use unprivileged ports.

The normal `docker compose` commands also use the generated override through
`COMPOSE_FILE`; its original volume override is preserved. Use the access commands
when changing modes so mDNS and shared-namespace recreation stay coordinated.
After a reboot, rerun `access:lan` to restore the user-owned mDNS announcement.
If DHCP or the selected network interface changes, keep the same hostname and use:

```sh
npm run access:lan -- --address 192.168.1.125
```

Reserve that address in the home router if desired. Router changes are manual.
The dedicated hostname, rather than the IP, is the persistent sign-in identity.
The server certificate lasts one year. Rerun `access:setup` to renew it using the
same CA; an already configured local-only mode remains local-only during renewal.

## Backups and failures

Everything generated stays under Git-ignored `private/network-access`, with
private directories/keys protected. Retain the whole directory securely: its CA
key is what permits renewing certificates without reenrolling your devices.
The public certificate directory alone is exposed by the setup page. The CA key
never enters a container; the app receives only the public CA, and the proxy
receives only its leaf certificate/key.

The central volume retains `identity-backup-*.sqlite3` and an
`identity-cutover-*.json` journal. Identity changes require stopped/drained writers,
an exclusive maintenance lock and a durable `RESTART_BLOCKED` gate. The database preparation keeps the gate installed even after its transaction
commits. Only a separate finalizer releases that operation's gate after verifying
the exact SHA-256 hashes of the planned `.env` and generated HTTPS override. Both
configuration files are flushed before activation. Missing files, write failures,
changed configuration or another operation's gate remain blocked. Failure leaves
the gate in place for operator recovery. A retry never silently deletes an
existing restart gate. There is no cross-service power-loss transaction: after an
interrupted initial cutover, keep writers stopped, inspect the journal and backup,
and reconcile the issuer/configuration together before removing any gate.

A cutover or startup failure stops the application rather than accepting logins
under partially applied identity settings. Preflight refusals leave the existing
valid deployment running. Read the restricted `operations.log` and
`mdns.log`. Ordinary listener/startup failures can be retried with the same command.
If the database restart gate remains, keep all writers stopped and inspect its
operation ID and journal; do not blindly rerun preparation or delete the gate.
After reconciling the saved activation plan and configuration, the offline
`network-identity.ts complete` finalizer accepts only that operation and its exact
configuration files. Restoring the matching central backup and original environment
together is the alternative operator recovery path.
If `operation.lock` survives a crash, check its recorded PID and ensure all access
operations have stopped before removing that host-side lock. Do not remove an
unrelated database-maintenance gate or lock to force startup.

`environment-before-network` and `keycloak-client-before.json` retain the original
local configuration and callback settings. Rolling back initial HTTPS adoption
also requires restoring the matching central identity backup with all writers
stopped; restoring `.env` alone leaves accounts bound to the HTTPS issuer. Keep
private study files intact. Prefer switching to `access:local` for ordinary
isolation rather than undoing the one-time HTTPS identity transition.

Implementation references: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[Keycloak hostname configuration](https://www.keycloak.org/server/hostname), and
[trusted reverse-proxy headers](https://www.keycloak.org/server/reverseproxy).
