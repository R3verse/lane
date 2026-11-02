# Lane 0.8 security design

This is an implementation review and documented threat model, not an independent security audit.

## Trust and transport

The Lane computer is trusted to host browser code, manage pairing, retain file bytes and serve the directory. Paired browsers are authorized participants, not administrators. Per-recipient authorization protects files and conversations from other participants. Bonjour advertisements are untrusted hints and never confer pairing rights.

Production Lane uses a unique P-256 local CA with path length zero, a P-256 server key, serverAuth EKU, digital-signature usage and SAN entries for current private IPv4 addresses, localhost and the instance’s Bonjour hostname. TLS 1.2 is the minimum, with TLS 1.3 supported. Node integration tests validate the chain. No certificate-error bypass exists in the app. The browser smoke test trusts only its test leaf’s SPKI in an isolated Edge process, without modifying the OS trust store.

Certificate private keys are protected through Electron safeStorage/Windows DPAPI in the desktop application. Standalone test receivers use isolated temporary key files. Root trust is a user action. The downloaded root must be inspected in the device certificate installer against the fingerprint on the computer’s own screen; the HTTP setup page alone is not trustworthy. CA rotation is not automatic and requires renewed trust. Copying DPAPI data to a different Windows account is insufficient to restore the HTTPS identity.

New profiles require HTTPS. Legacy profiles retain HTTP during migration. HTTPS-only mode blocks HTTP app code, pairing and file/message APIs. Only public certificate download and setup remain. No automatic downgrade occurs. Local-address and Host/Origin checks apply to both listeners. Download cookies are HttpOnly, SameSite=Strict, path-scoped and Secure on HTTPS. Pairing uses one-use five-minute codes; server tokens are stored hashed.

Version 0.8 permits cross-site top-level GET document navigation to the public root, setup and root-certificate routes after validating Host. HTTP-to-HTTPS setup navigation needs this because fetch metadata is schemeful. Cross-origin APIs, scripts, private downloads, frames and mutating methods are still rejected. Tests exercise both the narrow exception and its boundaries. Browser trust is not inferred from `isSecureContext` alone: a client may have bypassed a certificate error. The UI exposes diagnostic certificate metadata without changing OS trust or rotating existing roots.

## Message bodies

Endpoint P-256 ECDH identities are generated and stored in browser profiles. Public keys register once and are pinned. HKDF-SHA-256 derives the AES-256-GCM key from the shared secret with a versioned salt and canonical public keys in the context. Random 96-bit nonces are used. Associated data binds protocol version, sender, recipient, client ID and format. Retries retain their encrypted envelope. The receiver rejects altered duplicates, unregistered sender keys and plaintext downgrade once keys exist.

Tests cover independent Node decryption, maximum Unicode size, ciphertext/nonce/metadata tampering, mismatched/missing keys, persistence and dropped-response retries. Verification codes allow out-of-band key comparison; QR fragments pin the computer key during pairing.

Static identities provide no forward secrecy or post-compromise recovery. Metadata, receipts and reactions are outside end-to-end encryption. Browser storage contains private keys, drafts and pending cleartext; old plaintext history remains plaintext. A compromised host can replace served JavaScript, and a compromised endpoint can read decrypted content. Verified HTTPS improves network/code-delivery protection but does not remove trust in the code host.

## Recovery

Backups encrypt one endpoint and receiver scope using PBKDF2-SHA-256 (600,000 iterations, 128-bit random salt) and AES-256-GCM (96-bit random nonce, versioned associated data). The complete payload is authenticated. Import fixes the KDF cost, bounds file size, restricts storage keys to the expected scope, validates the private/public-key relationship and verifies the original pairing’s key against the server before writing storage. Wrong passwords, scopes/types, altered ciphertext and unsupported parameters fail without changes. Storage write failures attempt to restore previous values.

Backups omit received history, files and file handles. Revocation survives restoration. Server data needs separate backup, and forgotten backup passwords cannot be reset. Copies of the same identity act as the same device, including shared receipts.

## Conversation clearing

Clearing removes matching current message records, including reactions/receipts, and atomically persists a fresh random generation under a hash of the participant pair. Unrelated conversations and received files remain. The generation marker is necessary state, not a message archive. A failed persistence attempt restores the in-memory conversation.

Clients fetch the generation before sending a pending queue. The server rejects stale or absent generations after a conversation has been cleared, including retries whose old deduplication record has been deleted. Generation changes purge endpoint drafts, pending plaintext/envelopes, rendered text, reader/copy panels and current message arrays. Directory polling also clears saved local conversations that are not currently selected; storage events notify other open tabs. Async fetch/decrypt/send results from a pre-clear client run are discarded. Tests cover restart, offline clearing, old endpoint-backup restoration, fresh post-clear messages and preservation of other conversations.

This is cooperative deletion in current Lane clients against the current receiver, not cryptographic or forensic erasure. Offline clients/other origins must reconnect, older clients must reload, and browser/OS snapshots, storage journals, SSD remapping, swap and external copies are outside application control. Restoring an old receiver database can roll back generation state. A malicious participant can retain or resend content. Static ECDH identity keys are retained and can still decrypt previously captured ciphertext; generations are not a ratchet and do not provide forward secrecy. No guarantee of 'no trace' or irrecoverability is made.

## File restart recovery

Project destinations (0.10) are configured only through trusted desktop IPC and a native folder picker. Authenticated browser clients receive labels and IDs and cannot register paths. A new upload resolves its ID against the host's approved destinations; retries must retain the original destination as well as sender, recipient, filename and size. In-flight uploads keep their pinned folder when a destination is removed. All paired participants can use all configured destinations. This does not implement per-device folder permissions. Free-space reservation conservatively includes unfinished uploads across destinations, including folders that may share a disk.

Offsets persist after completed chunks are synced. Recovery requires an authorized sender/recipient, matching app-owned UUID partial path, a regular file in a non-symlink partial directory, valid bounds and activity within 24 hours. Trailing uncommitted bytes are truncated. Reused client IDs must keep filename, size and recipient. Ownership, revocation, cancellation, quotas and final SHA-256 checks remain. The original browser page must retain its File object; browser-reload continuation is not yet supported.

## Remaining review priorities

- Independent protocol review and evaluation of a maintained ratcheting protocol for forward secrecy.
- Signed Windows releases and verified update delivery.
- Root renewal/replacement UX, key rotation and full receiver backups.
- Physical iPhone/Android testing, large files, disk-full and power-loss behavior.

## Home Screen metadata (0.9)

The public manifest and icon contain no pairing credentials or device identity. The launch URL is the root path, without a pairing fragment. Manifest, icon and web-app script follow the HTTPS-only policy. No service worker or offline response cache is introduced. Home Screen installation does not replace certificate verification or extend background execution privileges.

## Search, mute and diagnostics (0.10)

Conversation search filters already decrypted messages on the endpoint. It can request up to 1,000 recent encrypted records, but adds no server-side plaintext index or persistent search cache. Clearing also resets the search query and results. Mute preferences affect alerts on the chosen endpoint; they do not change delivery, unread counts or encryption.

Diagnostic export uses a fixed allowlist of version, client category, boolean capabilities and nonnegative numeric response time. Arbitrary errors, addresses, file paths, names, tokens, keys and content are excluded. The preview is visible before a user saves a report; Lane does not upload it. A successful connection check is not a certificate audit, phone compatibility certification or full upload test.
