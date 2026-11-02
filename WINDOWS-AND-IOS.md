# Lane from Windows, without Apple enrollment

21 September 2026. Current decision: keep development on Windows and use the existing browser/Home Screen client. Native iOS development is parked because it does not currently make business sense. No prototype, Apple enrollment, D-U-N-S registration, cloud build account or payment has been initiated. The native options below are retained only as reference if that business decision changes.

## What is possible

| Route | Develop from Windows? | What it means for Lane |
| --- | --- | --- |
| Browser / Home Screen web app | Yes; no Apple Developer membership | Best fit now. Lane 0.9 adds a Home Screen icon/manifest, a setup guide, standalone presentation and upload wake-lock support where available. |
| Cloud native builds, such as Expo EAS | Yes; the service supplies the macOS build environment | Avoids owning a Mac, but native device distribution/TestFlight still needs signing credentials and Apple Developer enrollment. It would mean building a separate native client. |
| Free Apple Personal Team | Apple's personal-device testing route uses Xcode | Useful with macOS/Xcode access, but does not solve a Windows-only workflow or public distribution. It has restrictions and short-lived provisioning. |
| AltStore Classic on Windows | Windows can install/refresh a previously built app | A personal sideloading option, not a native compiler or effortless customer distribution. A free-account setup has app limits and seven-day expiration/refresh requirements. |

Expo documents Windows support for its build/submission commands and the paid-account prerequisite for TestFlight. Apple's account comparison distinguishes personal Xcode testing from distribution. AltStore documents its Windows installation route and refresh limits. These are different solutions to building, signing and installing; no single one removes all three constraints. [Expo](https://docs.expo.dev/submit/testflight/), [Apple accounts](https://developer.apple.com/support/compare-memberships/), [AltStore Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows), [AltStore limits](https://faq.altstore.io/altstore-classic/your-altstore).

Do not select Expo Go on the assumption that every current iOS SDK can be tested without enrollment. Expo's current physical-device setup documentation includes Apple Developer membership requirements, while older/general guidance may differ. This is another reason not to rewrite Lane around a prototype host merely to avoid distribution setup. [Current Expo iOS setup](https://docs.expo.dev/get-started/set-up-your-environment/?device=physical&mode=expo-go&platform=ios).

## The route implemented now

Open the verified HTTPS Lane page, then **Settings → Lane on your Home Screen → How to add Lane**. On iPhone, use Safari's Share menu and Add to Home Screen; keep Open as Web App enabled if offered. On supported Android browsers, use the browser's install/add menu or Lane's Install button when the browser makes that action available. The icon opens the current receiver address without retaining a pairing code in its launch URL.

The icon, manifest and interface are served by the Windows computer. No third-party hosting is involved. The page does not introduce a service-worker cache for messages, files or pairing credentials. The computer must still be reachable to load the page. Home Screen presentation does not repair certificate trust: complete verified HTTPS setup first.

Browser and Home Screen storage may be separate. If the icon opens an unpaired session, save an encrypted browser backup in the original Safari tab and restore it in the Home Screen session to retain the message identity, or intentionally pair it as a separate device. Changes to the receiver IP/origin can require migration or adding a new shortcut.

Modern iOS supports Home Screen web-app presentation without requiring a service worker; Apple Developer membership is not needed for a web app. [WebKit's Safari 26 explanation](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).

During uploads, Lane can request that a supporting browser keep the screen awake. This is enabled by default only as a preference: it acquires a lock when an upload starts, releases it when the queue finishes, and releases/reacquires around visibility changes. Settings offers an off switch and explains declined requests. It requires a secure context and platform support; the OS may refuse it for battery or other reasons. It is not a background-transfer entitlement. [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

## Limits that the Home Screen does not remove

- Safari does not expose programmatic website vibration. Native-style incoming haptics remain unavailable.
- Sound still depends on activation, output volume, system behavior and the page being able to run.
- Locking the phone or leaving Lane may suspend work. Wake lock helps a visible upload; it cannot override an explicit lock.
- A running local computer and reachable network remain necessary. A Home Screen icon does not turn the phone into an always-on local server.
- Background web push is possible for supported Home Screen web apps without paid Apple membership, but it uses Apple's internet push service. That would be an explicit optional feature with a different network dependency. No push service has been added. [WebKit Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API).

## Business decision

There is not yet evidence that Lane is a viable paid business. LocalSend and PairDrop already cover strong free alternatives. More chat features, encryption claims or an iOS icon do not establish willingness to pay. [LocalSend](https://localsend.org/), [PairDrop](https://github.com/schlagmichdoch/PairDrop).

My recommendation is to use Lane yourself and test it with five people before spending on native distribution or billing. Investigate one recurring task, such as collecting work photos into the correct Windows project folder with notes. Measure how long it takes, how often it fails, whether people return without prompting, and whether it beats their current tool. If it does not, keep it as a useful free utility or stop commercial expansion. That is a sensible outcome, not a reason to manufacture a subscription.

The revised [roadmap](ROADMAP.md) keeps reliability and repeat-use validation first. Workflow automation may later justify a one-time purchase; managed deployment and real support might justify recurring team fees. Neither is built or promised as a revenue source now.
