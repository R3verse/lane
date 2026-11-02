# Validation — Lane 0.10.0

Windows 11 x64, 22 September 2026.

- Unit / receiver integration: **48 passed, 0 failed**.
- Source GUI integration over private LAN IPv4: **passed**; packaged checks repeat against the final build.
- Source HTTPS migration GUI: **passed**.
- Packaged desktop/mobile and HTTPS GUI: **passed**, including project-folder uploads, desktop/browser diagnostic export, local search, conversation mute, clipboard review, minimum-window composer layout and existing transfer/message regressions.
- Real Bonjour multicast between isolated advertisements: **passed in 0.7**; the discovery transport is unchanged in 0.10.
- NSIS installer and portable Windows executables: **built successfully**.
- Archive verification: **42 source/assets files match byte for byte**; packaged version is 0.10.0. SHA-256 checksums are saved with the release.
- Builds remain unsigned.

## Changes exercised

0.10 adds approved project-folder selection, one Devices view, collapsed conversation search, per-conversation mute, redacted connection diagnostics, browser paste review and Retry failed. New receiver tests reject unapproved destination IDs and changed retry destinations, check directory responses for path exclusion, remove a destination during a transfer and complete that transfer into its pinned folder after restarting. Desktop mute persistence is checked. The diagnostic sanitizer rejects arbitrary strings and excludes private fields.

The extended HTTPS GUI creates a project through a stubbed native folder picker and the real desktop UI, uploads a file through the phone's Save in selection and compares disk bytes. It previews/exports diagnostics, exercises local search and toggles conversation mute before receiving messages. Clipboard-file selection uses a synthetic browser paste event, then verifies that no file is saved until Send is clicked. This checks application handling, not every OS/browser clipboard implementation. The wake-lock API is mocked; the old physical-device limitations below still apply.

The full GUI regression caught an overflowing composer at the minimum desktop window size; compact layout and collapsed search controls correct it. Visual inspection also moved project folders beside receiving settings and kept search out of the default reading space.

0.9 adds manifest/icon serving, the Home Screen guide and upload-only screen wake lock. Unit tests cover completion, cancellation before a grant, visibility changes, opt-out, denial and retry. The HTTPS GUI mocks the wake-lock API to verify upload lifecycle and opt-out wiring; it does not establish physical iPhone wake-lock behavior. The guide and settings were reviewed at mobile width. Actual iPhone Home Screen installation remains unverified.


Dedicated mobile Settings, circular gear controls, appearance persistence, name changes, Web Audio Test sound/Reset audio, capability-dependent vibration controls, connection diagnostics, and conversation security behind an info button. Final screenshots were reviewed on desktop and at mobile width. This caught and corrected a legacy height limit on the security dialog and low-contrast checkbox labels.

Clearing tests remove one conversation while preserving another, reject stale sends before/after receiver restart, remove old bodies/client IDs from the active message store and allow fresh messages. The GUI queues text and leaves a draft on an offline phone, opens a long note in its reader, clears from the other phone, then reconnects: the reader, draft and queue are purged. Restoring the old endpoint storage and reloading still does not resurrect the queue. A fresh post-clear conversation succeeds. These checks establish application behavior, not forensic erasure.

Discover cards, device details, chat/file actions, multiple paired participants, device names/profiles, scrollable lists, filters and responsive mobile navigation. Notification checks distinguish the active conversation from hidden desktop windows and other views. Read receipts require an attended conversation; unread content below the viewport has a jump control.

Existing tests continue to cover encrypted Unicode/long notes, formatting, clipboard and note export, reactions, delivery/read states, queued messages across reload, lost-response deduplication, file selection review, visible Sent feedback, binary integrity, incoming/outgoing/relayed files, native picker/Send to integration, folder changes, cancellation, pause/retry and revocation.

## HTTPS and recovery

The HTTPS test validates the actual generated CA chain with Node’s TLS client and rejects it without that CA. It checks HTTPS app serving, encrypted pairing and downloads, Secure cookies, Host/Origin rejection, HTTP API/script/download blocking, public certificate/setup access, persisted trust across restart and leaf renewal after an address change. Cross-site top-level public navigation is allowed while API/download/script routes, POSTs, iframes and invalid Hosts remain blocked. Enabling Require HTTPS also disconnects an already-open HTTP upload and rolls back its incomplete chunk; HTTPS retry succeeds.

The HTTPS GUI uses a private LAN address and a certificate-specific SPKI allowlist in an isolated Edge process, never a blanket certificate bypass or OS root installation. It clicks the real HTTP setup → HTTPS link. It migrates an existing HTTP browser through the password-protected backup interface and verifies the original device ID, old encrypted note, draft, HTTPS reply and binary upload. It also checks the setup QR/fingerprint and mobile layout.


Recovery tests reject wrong passwords, receiver scopes, client types, modified ciphertext and unsupported KDF costs. Identities and Unicode drafts survive restoration into fresh storage. Backups are checked for plaintext absence. File restart tests preserve a committed chunk, remove an uncommitted tail, reject another device’s access and a mismatched filename, and verify the final bytes after completion.

## Test scope

Electron profiles, pairing tokens, browser contexts, downloads and shortcuts use isolated temporary directories. The suites do not modify the user’s real trust store, firewall, startup entries, files or pairings. The installer is built but not installed automatically.

Audio regression tests simulate gesture loss, rejected starts and an interrupted resume; they verify synchronous activation, truthful failure reporting and reset recovery. Packaged GUI tests exercise the actual Web Audio engine and mute/suppression logic. They do not confirm physical iPhone audibility, media volume, Silent Mode, Bluetooth routing or Safari suspension. Mobile testing uses Edge emulation at 390 × 844, with a 980 × 680 minimum desktop layout check; physical Safari and Android tests remain needed. Safari vibration is unavailable rather than simulated. There is no claim of an independent security audit, forward secrecy, fully encrypted host storage, forensic erasure or background iPhone push.

Message bodies retain end-to-end encryption. HTTPS protects transport and served browser code after root verification. Metadata, reactions and relayed files remain visible to the host; the host also controls the browser code it serves. Legacy HTTP compatibility must be disabled after migration for transport protection to apply consistently. See SECURITY.md.

## Evidence

- test-output/server-0.10.log
- test-output/ui-smoke-0.10-source.log
- test-output/https-ui-0.10-source.log
- test-output/ui-smoke-0.10-packaged.log
- test-output/https-ui-0.10-packaged.log
- test-output/discovery-0.7.log (unchanged discovery implementation)
- test-output/build-0.10.log
- test-output/archive-0.10.log
- release/SHA256SUMS-0.10.0.txt

Screenshots include desktop/phone Discover, device details, HTTPS settings/setup, messages and full reading views, the mobile security dialog, the dedicated mobile Settings screen, file review, transfers and inboxes.

## Physical iPhone follow-up

Exit the old desktop receiver from its tray menu, launch 0.10, and reload the phone page. Keep the installed root: this release preserves it. From /setup, open the HTTPS link in a fresh Safari tab. Confirm no certificate warning remains; if it does, compare the actual Safari certificate issuer, address and dates against the desktop diagnostics before proceeding. In mobile Settings, enable sound and tap Test sound. Test from another conversation with Lane visible, then repeat after lock/unlock and another app's audio. Test Silent Mode and normal mode separately. Do not expect Safari vibration or guaranteed alerts while the page is suspended.

## Public-source preparation — 2 November 2026

Added “Coded by Max Jensen” to desktop Settings, mobile About and README. Rebuilt both unsigned 0.10.0 Windows executables; all 42 packaged source/assets files match the current workspace and SHA-256 checksums were regenerated. The automated suite again passed all 48 tests.

Removed a personal LAN address and running-server diagnostic details from public documentation; replaced personal example device names with generic examples. Reviewed all publication candidates for credentials, private keys, user paths, email addresses and IP literals. Remaining address literals are loopback/bind addresses or synthetic test fixtures. Dependency metadata and third-party license attributions are retained.

The source repository excludes release binaries/build output, node_modules, test-output, logs, environment files, certificates/private keys and local app-data paths. Test evidence files listed above are local artifacts, not public repository contents. Physical-phone limitations above remain unchanged.

Packaged desktop/mobile UI and HTTPS migration suites also passed after this refresh, including file integrity, encrypted messaging, project destinations and Settings. Release cleanup was blocked by the execution policy; old artifacts remain local and the entire release folder is excluded from Git.
