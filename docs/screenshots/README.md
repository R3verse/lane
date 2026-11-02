# Lane screenshots

Captured from the real Lane 0.10.0 interface on Windows, using an isolated test profile and synthetic messages/files. Device names are generic. Screenshots do not contain pairing codes, QR credentials, certificates, machine paths or network addresses.

- `phone-pairing.png`: one-time QR pairing from the phone browser. The QR itself is not included because pairing codes are temporary credentials.
- `desktop-transfers.png`: completed phone-to-computer transfers. Captured above the receiving-folder footer to exclude the private temporary path.
- `desktop-messages.png`: Electron desktop conversation, dark theme.
- `phone-file-review.png`: mobile browser file selection, recipient and explicit Send review.
- `phone-messages.png`: mobile browser encrypted conversation.

Mobile screenshots use Microsoft Edge with a 390 × 844 viewport and mobile emulation. They are not photographs of a physical iPhone and do not verify Safari certificate trust, sound or background behavior.

## Capture again

On Windows, install project dependencies with `npm ci`. Make Playwright available through `NODE_PATH` (or install it locally without changing the manifest/lockfile), ensure Microsoft Edge is installed, then run:

```powershell
node scripts/showcase.cjs
```

The script launches Lane with isolated temporary app data, creates a test-only local CA, and allows only that certificate in its isolated Edge process. It does not install system certificate trust. It disables nearby discovery for the capture, pairs a synthetic device and captures the real UI without changing its styling or fabricating app state. It closes the test processes and removes temporary app data afterward. The script requires a local HTTPS address; no physical phone is used.
