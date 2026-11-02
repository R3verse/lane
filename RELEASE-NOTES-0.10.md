# Lane 0.10 — a clearer local workspace

22 September 2026. Windows and browser clients. Native mobile applications remain parked.

## What changed

| Feature | Where to find it | Behavior |
| --- | --- | --- |
| Project destinations | Windows Settings, beside Receiving folder | Name up to 20 folders. Paired phones choose a name under Save in before sending to the computer. |
| One Devices view | Desktop navigation and phone tabs | Paired devices and nearby computers share search, filters and device details. Open a card to message or send. |
| Local message search | Search icon in the conversation header | Search loaded text or request up to the latest 1,000 messages. The search field opens only when needed. |
| Conversation mute | Bell in the conversation header | Suppress this conversation's banners and sounds on the current device. Unread counts remain. |
| Connection check | Settings on both clients | Check receiver availability and capabilities, preview a redacted report and save it locally. |
| Clipboard selection | Browser Send files view | Pasted files/images appear for review where supported; Send remains explicit. |
| Retry failed | Browser transfer queue | Retry only failed items without resending completed ones, while originals remain in the page. |
| More reading space | Messages | Header controls and a compact minimum-window layout preserve room for messages and the composer. |

## Updating

Exit the previous Lane receiver from its tray menu. Start Lane 0.10 and reload the phone page. Pairings, the certificate authority, messages and existing receiving settings are retained. No installer is run automatically, and no trust store or firewall settings are changed. Builds remain unsigned.

Project folders are available to every paired participant. Removing one removes the saved destination, not its files; in-flight transfers retain the folder selected when they started. For relayed phone-to-phone files, Lane continues to use the normal receiving folder on the host.

Search is local and limited to the latest 1,000 records available to the conversation. It creates no extra persistent plaintext index. Mute is specific to the device where it is set. Diagnostic reports exclude names, addresses, file paths, keys, tokens, messages and file contents.

## Still on the roadmap

This release does not establish physical iPhone certificate trust, audibility, background delivery or hardware vibration. These still need physical-device validation or are limited by the browser. The connection check cannot prove that a certificate warning was not bypassed.

Full receiver backup, resuming a file after browser reload, linked batch notes, replies, timed retention, automation rules and stronger key lifecycle changes remain future work. Windows signing and an independent security review need external services or expertise. None are represented as completed by the current release.

See [validation](VALIDATION.md), [security](SECURITY.md) and the [updated roadmap](ROADMAP.md) for scope and evidence.

## Public-source refresh — 2 November 2026

Added “Coded by Max Jensen” in desktop Settings and mobile About. Refreshed the README with a source quick start and sanitized local diagnostic details. Rebuilt unsigned 0.10.0 downloads with new checksums; no protocol or data migration changes.
