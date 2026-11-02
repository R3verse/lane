# Lane: product review and development roadmap

Updated 22 September 2026 · Based on Lane 0.10, automated tests, supplied iPhone screenshots and the official sources linked below. Competitor descriptions are documentation comparisons, not hands-on benchmarks. Proposed prices and demand are hypotheses, not evidence of a viable business. The delivery table below distinguishes implemented work from the original backlog; unmarked future features are not scheduled commitments.

## Delivered in 0.10 and remaining work

| Roadmap item | Delivered in 0.10 | What remains |
| --- | --- | --- |
| Unified Devices | One navigation destination for paired and nearby devices, filters, search, details, chat/send actions and desktop revocation | Physical-network discovery validation and any further accessibility refinements |
| Project destinations | Up to 20 named, desktop-approved receiving folders; phone selection and remembered preference | Folder permissions per participant, naming rules and automation |
| Conversation search | On-device search of loaded text, optionally up to the latest 1,000 messages; collapsed by default | Full-history pagination/search beyond that limit |
| Conversation mute | Bell control on both clients; banners/sounds muted per conversation while unread counts remain | Timed mute and retention policies |
| Connection check and report | Reachability/capability checks, report preview and local export with private fields excluded | Guided test upload and unresolved physical Safari certificate/audio checks |
| Paste and transfer feedback | Browser pasted-file review, explicit Send, named destination in batch result and Retry failed | Native Windows clipboard-file intake, reload-safe reselection and linked batch notes |
| Responsive messages | Search controls open on demand; compact desktop layout preserves composer at minimum window size | Physical keyboard, large-text and screen-reader matrix |

This release implements a useful Windows/browser workflow slice, not every future item. The original feature tables below retain their 0.9 starting points for comparison; this table is the current delivery status. Native applications stay parked. Signing, external security review, billing, remote services and a new encryption protocol remain separate milestones. Full receiver backup, reload-safe file recovery, batch notes and retention still require design and testing; they are not implied by the new folder and search controls.

## Recommendation

Build Lane around a specific job: **get work from a phone browser onto a Windows computer, in the right folder, with a useful conversation attached, without putting the content in cloud storage**. Development stays focused on the Windows receiver and browser/Home Screen client. Native iOS development is parked because its build, distribution and maintenance costs do not make business sense without proven demand. Lane 0.9 adds a Home Screen manifest/icon, installation guidance and optional upload screen wake locks without new accounts or services. [Windows and iOS options](WINDOWS-AND-IOS.md) remains background reference rather than an active build plan.

**Commercial decision: do not build billing or commit to a subscription yet.** Useful software is not automatically a business. Keep the next investment small: reliability, five real users and one observed repeat workflow. Treat the project as a personal/free utility unless those trials reveal a concrete reason to pay. It is reasonable to stop commercial expansion if people prefer existing alternatives.

Do not position the current product as an SMS replacement, an unbreakable messenger, or a way to guarantee that deleted content has left no trace. Those promises exceed both the current design and platform capabilities. A local transfer workspace with useful notes is a clearer, more defensible product.

## What exists, and where it still falls short

| Area | Lane now | Most useful next improvement |
| --- | --- | --- |
| Transfer | Arbitrary files, explicit Send, named project destinations, clipboard-file review in supported browsers, Retry failed, history, two-way and phone-to-phone relay | Recover after reselecting a file following browser reload; test multi-gigabyte iPhone videos and low disk space |
| Pairing | One-use QR/code, saved browser identity, editable names, local HTTPS | A guided first connection that proves the phone can reach the secure page before inviting a transfer |
| Devices | Unified paired and Bonjour-discovered Lane computers, connected/paired/nearby filters, details and actions | Physical network testing and clearer recovery when a receiver changes address |
| Messaging | Long notes, reactions, delivered/read states, reading view, local search and per-conversation mute | Replies, linked batch notes, optional retention and full-history search; keep these secondary to transferring work |
| Privacy | Encrypted message bodies, HTTPS, key comparison, scoped file access | Independent review, maintained ratcheting protocol, endpoint key storage improvements and signed distribution |
| Deletion | History and reactions removed from the receiver; drafts/queues purged on reconnect; old queues rejected | Retention controls and a reviewed key lifecycle; explicit limits around external copies and storage remnants |
| Mobile controls | Dark/light modes, dedicated Settings, audio reset/test, capability-aware vibration, Home Screen guide/icon, upload wake lock and reduced-motion CSS | Physical Safari testing, larger accessibility text, keyboard/safe-area and Home Screen identity testing |
| Desktop | Tray, startup, taskbar indications, Windows Send to, project folders and redacted diagnostic export | Signed updates and robust receiver/key migration |

The strongest existing qualities are local operation, explicit file review, recipient-specific delivery and preserving long text. The largest UX cost is certificate onboarding. Settings used to be hidden under Devices, and security details occupied valuable chat space; 0.8 addressed those two layout problems. Version 0.10 brings Discover into Devices and keeps search collapsed until requested so the conversation has more room.

## Where I see Lane going

The most useful direction is a **local workspace connecting a phone to the work happening on a Windows PC**. Files should arrive with their destination and context already clear. Messages support that handoff: a note explaining a set of photos, a link to use on the other device, or instructions attached to a document.

For example, someone opens Lane on their phone, chooses a project called “Kitchen renovation”, selects twelve photos and adds “Measurements from Monday”. The PC receives the originals in that project's folder, shows the note beside the batch, and reports which files arrived. Next time, the destination is already available. That complete workflow is a proposal, not current functionality.

There are three possible outcomes. A dependable personal utility is a worthwhile result on its own. If people repeatedly need organization and automation, Lane could become a paid Windows workflow tool. A managed team product should follow only if businesses request it and fund pilots. Growing a general-purpose messenger would spread development across a much larger problem without proving why people should switch.

## Proposed feature list and priorities

**Now** means the next recommended work, **Next** follows reliable device testing, **Later** requires demand or a separate architecture decision, and **Deferred** is outside the current plan. Effort is relative: S is a contained change, M crosses several screens/components, L changes storage or protocol behavior, and XL is a major platform/security project. These are planning estimates, not delivery dates or quotations.

### Reliability and everyday use

| Proposed feature | Starting point in 0.9 | Priority / effort | Benefit and completion check |
| --- | --- | --- | --- |
| Guided connection health check | HTTPS setup and certificate diagnostics exist; reported Safari trust warning remains unverified | Now / M | Show reachability, exact address, secure-context status and a test transfer. Validate on the actual iPhone without bypassing warnings; never claim the page can inspect iOS trust settings. |
| Physical-device compatibility checklist | Automated Edge mobile emulation; no confirmed physical iPhone audio result | Now / M | Record Safari/Android version, Home Screen behavior, audio routes, lock/unlock, keyboard and Wi-Fi changes. Publish known limitations alongside results. |
| Large-transfer recovery and storage checks | Chunk retry survives receiver restart while the original sender page remains open | Now / L | Test large videos, disk-full handling, cancellation and disconnects; verify exact bytes and cleanup of incomplete files. |
| Resume after reopening the phone page | Browser File objects do not survive reload | Next / L | Let users reselect originals, verify content identity against saved transfer state and continue safely; never resume solely because filenames match. |
| One Devices area with Nearby and Paired sections | Discover and Devices are separate | Next / M | Show trusted, unpaired, connected and offline states with search and scalable lists; retain explicit pairing before interaction. |
| Persistent transfer result and batch summary | Explicit Send, progress and completion feedback already exist | Next / M | Make mixed success/failure easy to review, retry only failed items and show the destination. Distinguish browser download from saving to Photos. |
| Accessibility and mobile keyboard pass | Responsive layout, reading view and reduced-motion CSS exist | Now / M | Test large text, screen readers, focus order, contrast and the composer with the keyboard open. Long messages remain readable without horizontal page scrolling. |
| Connection diagnostics export | Diagnostics are visible in Settings | Next / M | Preview and export a redacted report with versions and failure reasons, excluding keys, tokens, messages and file contents; sharing stays voluntary. |

### Features that could make Lane more useful than a basic transfer tool

| Proposed feature | Starting point in 0.9 | Priority / effort | Benefit and completion check |
| --- | --- | --- | --- |
| Favorite destinations and project folders | One configured receiving folder and recipient selection | Next / M | Save named destinations on the PC and expose only authorized choices to senders. Keep remote requests inside approved folders. |
| Batch notes linked to files | Messages and transfers are separate | Next / M | Attach a note to a reviewed batch and find the note from its transfer history; define retention and encryption of the note before storage changes. |
| Paste images, files and links | File picking and text composition exist | Next / M | Reduce steps through explicit paste/review/send actions where supported; never monitor the clipboard continuously. |
| Filename templates and destination rules | Files use current receiving behavior | Later / M | Preview a rule before enabling it, preserve originals, prevent overwrites and record where a batch went. Build after users demonstrate repetitive sorting. |
| Duplicate review | No user-facing content-based duplicate workflow | Later / L | Compare content hashes, offer keep/skip/rename choices and avoid silently deleting originals. Measure the cost on large videos. |
| Local message search | Long notes and reading view exist | Next / L | Search decrypted content on the endpoint, with a storage/retention design that does not upload a plaintext index to the relay. Clearing removes the index too. |
| Replies and pinned notes | Reactions and read/delivery states exist | Next / M | Reference a message and keep useful notes accessible; deleting the source also removes retained previews and references according to documented rules. |
| Per-conversation mute and retention | Global alert/sound preferences and manual clear exist | Next / L | Offer quiet conversations and optional history expiry. Test offline reconnection and describe deletion limits honestly. |
| Temporary guest access | Persistent QR pairing exists | Later / L | Permit a narrowly scoped send session with expiry, limits and revocation; guests cannot browse other devices, history or destinations. |

### Security, distribution and longer-term options

| Proposed feature | Starting point in 0.9 | Priority / effort | Dependency / decision gate |
| --- | --- | --- | --- |
| Signed Windows releases and verified updates | Unsigned installer and portable builds with checksums | Next / L | Choose signing and update infrastructure; verify signatures before execution and test recovery from interrupted updates. Requires operating costs. |
| Complete receiver backup and migration | Browser identity backup exists | Next / L | Restore receiver identity, configuration and intended history on another PC without silently weakening key protection; test loss and rollback cases. |
| Independent security review | Internal tests and documented threat model | Next / L | External expertise and budget; address findings before stronger security claims or sensitive business deployments. |
| Reviewed forward-secrecy protocol | Message bodies are encrypted; current static keys have stated limits | Later / XL | Select a maintained protocol/library, migration design and independent review. Do not invent proprietary “unbreakable” crypto. |
| End-to-end encrypted relayed files | HTTPS protects each hop; host can read relayed files | Later / XL | Validate a need to hide content from the host, then design streaming encryption, resumability, key distribution and integrity tests. |
| Easier browser HTTPS onboarding | Per-computer local CA and manual device trust | Research next / L | Prototype a unique-domain/certificate approach and evaluate DNS, renewal, offline operation and cost before adoption. Never share a private key across installations. |
| Native mobile applications | Browser/Home Screen client available | Parked / XL | Outside the active roadmap. Reconsider only after repeat use proves that a browser limitation blocks a valuable workflow and users will support the added platform cost. |
| Optional internet notifications or remote access | Local network operation; no push service | Deferred / XL | A separate opt-in architecture, privacy and cost decision. Keep the local core functional without the service. |
| Team receiver with roles and quotas | Multiple paired participants; not enterprise administration | Deferred / XL | Paid pilots must justify permissions, device lifecycle, deployment, supported updates and support obligations. Keep audit metadata minimal and explicit. |

## Recommended next development sequence

| Step | Deliverable | Exit condition |
| --- | --- | --- |
| 1. Make the current promise dependable | Physical iPhone troubleshooting, connection check, large-file and accessibility fixes | A real phone completes pairing, a note and an interrupted file transfer with understandable feedback; remaining platform limits are documented. |
| 2. Make repeat use easier | Unified Devices view, favorite destinations, batch notes and explicit paste/send | Five trial users can repeat their own workflow without coaching and identify where the files went. |
| 3. Make release and recovery dependable | Signing/update design, receiver recovery drills and security review | An upgrade and restore preserve the expected data and trust relationships; review findings have owners and resolutions. |
| 4. Choose a product direction | Compare the trial with users' existing method and test one paid workflow concept | Repeated voluntary use and concrete purchase/pilot interest justify further investment; otherwise keep a free personal utility. |

Security defects interrupt this sequence and take priority. Signing and review should move earlier if distribution widens. The feature tables are a backlog to choose from, not a commitment to build everything. Native mobile development, cloud services, paid accounts and billing are outside this roadmap unless a later business decision explicitly brings them back.

## HTTPS, encryption and deletion decisions

**Keep HTTPS.** A root certificate being self-signed is normal for a private certificate authority. Safari can trust that authority when the correct profile is installed and Full Trust is enabled. Payment is not what makes a certificate valid. Lane issues a separate server certificate with address SANs, SHA-256 signatures, server-auth usage and a short validity period. [Apple trust guidance](https://support.apple.com/en-us/102390), [Apple certificate requirements](https://support.apple.com/en-us/103769).

For the supplied screenshots, we confirmed a Lane application bug: the cross-site guard rejected a top-level move from HTTP setup to HTTPS. It is fixed in 0.8 without allowing cross-origin API calls or private downloads. A Node client can validate a receiver's chain against its exported root and expected local address. This does **not** prove a phone trusts the same certificate. That remaining warning needs a fresh physical-device check and comparison of the actual certificate Safari presents. 0.8 exposes root/server fingerprints, validity and covered addresses for that check. Existing certificate identities are retained.

Replacing HTTPS with JavaScript encryption delivered over HTTP would leave the page and its encryption code open to alteration in transit. Keep transport protection and message encryption as separate layers. Current phone-to-phone file transfers are decrypted/stored by the computer between the two TLS connections; they are not encrypted against the host. Add streaming file encryption if hiding relayed file content from the host becomes a validated requirement. Independently delivered native clients would also reduce dependence on the host for message-client code.

**Clearing is application deletion, not a forensic wipe.** Lane 0.8 removes current server message records and signals both clients to clear drafts, pending text, reactions, reader content and rendered copies. A random conversation generation prevents compliant old clients or endpoint backups from retrying deleted queues. It contains no message body. Offline endpoints apply the clear when they reconnect. Another HTTP/HTTPS origin must also reconnect to learn about the clear. Previously exported notes, screenshots, clipboard history, external backups, a restored old receiver database and storage remnants can retain content. Static message keys also cannot make captured old ciphertext undecryptable. True key-based expiry requires a different, independently reviewed key lifecycle and still cannot retract a recipient's saved copy.

For easier browser certificates later, evaluate a real domain with automated DNS-01 issuance and local name resolution. DNS-01 can validate a domain whose web server is not exposed to the public internet. This is a proposed architecture, not present functionality: it needs domain/DNS operations, renewal connectivity, safe key handling and a plan for routers that block private DNS answers. Do not ship the same wildcard private key to every customer. The existing local authority remains useful for fully offline environments. [Let's Encrypt DNS-01 documentation](https://letsencrypt.org/docs/challenge-types/).

## iPhone sound, vibration and background delivery

The sound fix resumes Web Audio directly from a tap, removes the previous muted-play/pause race, bounds interrupted starts and provides Reset audio. A separate media player helps distinguish audio activation from volume/output problems. Automated tests exercise activation, failure, reset and alert suppression. Audible output, Silent Mode, Bluetooth routing, lock/unlock and Safari interruptions still require physical testing.

Safari does not provide the Vibration API. Lane therefore displays its unavailability on iPhone and offers vibration only when the browser exposes the API. Even a successful API request cannot prove the hardware vibrated. [MDN Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API), [browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json).

Lane 0.9 supplies a Home Screen icon/manifest, installation guide and standalone presentation; physical iPhone installation still needs testing. This does not add push notifications. Web Push on iOS requires a Home Screen web app and notification permission, and uses Apple's push infrastructure. It is a possible **opt-in internet feature**, not an offline guarantee. Avoid promising persistent background polling or abusing audio to keep the page alive. [WebKit's iOS Web Push explanation](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

A native app offers better foreground haptics, system integration and file handling, but does not get an unrestricted background LAN listener. Apple's background facilities are purpose-specific; general continuous background execution is unavailable. Background transfers can use supported transfer mechanisms, while instant remote alerts normally require a push path. Device notification preferences and Focus remain authoritative. [Apple's background execution guidance](https://developer.apple.com/forums/thread/685525).

## A simpler future interface

Use three main destinations: **Transfers, Messages, Devices**, with a visible gear for Settings. Make Discover a section of Devices instead of a competing list. At larger desktop widths, keep a device column beside the active workspace; on phones, show one focused task at a time.

Start with a short connection journey: choose the computer, complete trust if required, show a clear connected state, then offer Send files or Message. Provide an optional test transfer and sound check. Ask for notification/audio permission in context, not as a wall of first-run prompts.

Put the selected recipient, filename count, total size and destination above the Send action. Keep a persistent result with an explanation of where the file went. Distinguish received by computer, available to phone, downloaded by browser and saved by the user; never claim to have saved a photo to the iPhone library automatically.

For messages, preserve reading position, keep the composer usable above the mobile keyboard, put security details behind the info button, and allow large text throughout. Add searchable history only after choosing its retention/storage model. A 'save as note' shortcut is more aligned with Lane's purpose than building groups, calls, channels or a social network.

## Phased roadmap with acceptance criteria

| Phase | Work | Evidence needed before moving on |
| --- | --- | --- |
| 1 — Reliability | Validate 0.9 on physical iPhone/iPad and Android; cover trust, audio interruptions, Home Screen, upload wake lock, large videos, clear/reconnect and Wi-Fi changes; fix remaining issues | A documented device matrix; no unresolved pairing failures; exact file integrity after interrupted transfers |
| 2 — Trust and recovery | Independent security review, signed Windows installer/update path, explicit root/key rotation, complete receiver backup/restore and retention UX | Verified upgrade/rollback and loss-recovery drills; review findings resolved; clear threat model |
| 3 — Workflow value | Destination rules, named project folders, filename templates, deduplication review, paste/share shortcuts, reload-safe file reselection | Repeat users can finish their real workflow faster than their current method without losing originals |
| Optional later — Team offering | Managed receivers, device roles, expiry/revocation, policy settings, local administration and support | Several teams commit to a paid pilot for a clearly measured workflow benefit |

Treat these as gates rather than promised dates. New encryption protocols, platform background behavior and secure updating need more review than a normal UI feature. Defer group chat, internet relaying, user accounts and payment infrastructure until a target audience consistently uses the core product.

## Native mobile decision

Native iOS and Android applications are parked, with no discovery, prototype, cloud build, developer enrollment or store preparation planned. The product will continue to support phones through its local browser/Home Screen client. This keeps one mobile code path, preserves the no-account setup and directs effort toward connection reliability, file workflows and Windows integration.

Reopening the decision requires more than general interest. Trial users must repeatedly encounter a browser limitation that prevents a valuable workflow, the proposed native feature must address that limitation, and expected adoption or revenue must justify a second client, signing, store review, compatibility testing and long-term maintenance. If those conditions are eventually met, write a separate native feasibility plan before implementation. The existing [Windows and iOS reference](WINDOWS-AND-IOS.md) records the constraints already researched.

## Competitors and differentiation

| Product | Officially documented strengths | Implication for Lane |
| --- | --- | --- |
| [LocalSend](https://localsend.org/) | Free/open source, Windows/macOS/Linux/Android/iOS, local file and text sharing, HTTPS and optional PIN verification | Basic local transfer and encryption already have a strong free alternative. A subscription needs additional recurring value. |
| [PairDrop](https://github.com/schlagmichdoch/PairDrop) | Browser file/text sharing, persistent QR/code pairing, self-hosting, public rooms and internet-transfer options | 'Works in a browser' is not enough to differentiate. Lane can focus on a persistent Windows receiving workflow with conversations and folder rules. |
| [KDE Connect](https://kdeconnect.kde.org/) | Free/open source device integration: files, links, remote controls and platform-dependent phone integration | Avoid trying to match every remote-control feature. iOS support has its own constraints, as its [iOS project documents](https://github.com/KDE/kdeconnect-ios/blob/master/README.md). |

These are not claims that Lane is faster or more secure than competitors. No comparative throughput or security audit has been performed. The promising distinction is **a local intake desk for work**, with context and predictable destinations, especially for people using iPhones with Windows. The current version establishes that direction but does not yet prove a commercial advantage.

## Monetization and open-source options

I would keep ordinary local transfers, basic chat, encryption, accessibility, security fixes and data export free. Charging monthly just to move a photo between two nearby devices will be difficult to justify against capable free products. Never use fear about encryption or an unverifiable erasure promise as the upsell.

| Model | What customers might pay for | Main tradeoff |
| --- | --- | --- |
| Free/open source + donations | Supporting a useful community project | Good for adoption and review; revenue is unpredictable |
| Free core + one-time Pro purchase | Project destinations, automation rules, naming templates, duplicate handling, capture-to-folder workflows | Fits a personal utility; ongoing maintenance must be funded through enough sales or clearly defined paid major upgrades |
| Team subscription | Managed deployment, roles/policies, device lifecycle, local administration, supported updates and a support commitment | Recurring value is credible, but administration and support are substantial products to build |
| Commercial self-hosted support | Deployment assistance, maintenance and supported versions for organizations | Service revenue depends on time and expertise, not just download counts |

**Current decision:** defer monetization implementation. If repeat-use evidence appears, consider an auditable core once licensing/notices are settled and validate a one-time personal workflow tier before subscriptions. Make a team subscription a separate later offering. An open core can coexist with paid workflow modules or support, but decide the licensing model before accepting outside contributions. Public source enables scrutiny; it does not substitute for a security review. Nothing has been published or relicensed as part of this update.

As experiments, not forecasts, test **€19–29 once** for a personal Windows workflow edition and **€5–8 per active user/month** for a supported team edition. Interview customers before implementing those prices. Define included updates/support, offline license behavior and what happens on cancellation. Core local data access should not suddenly fail because a license server is unreachable. Budget for support, Windows code signing, payment fees and security maintenance.

## Validate demand before expanding

Start with 10–15 interviews across two narrow groups: iPhone/Windows users repeatedly importing work photos, and small teams collecting photos, PDFs and notes into project folders. Ask them to demonstrate their current workaround. Measure frequency, mistakes, time lost, cloud restrictions and who has purchasing authority.

Run five supervised trials using the current app. Proposed targets are a first successful transfer within three minutes of starting, an easy repeat send, and an understandable result without coaching. Record failures manually or with an explicitly shared diagnostic bundle; no hidden telemetry is needed. Try the same job with LocalSend or PairDrop to see whether Lane actually saves effort.

Only build the paid workflow that multiple participants ask to use again and agree to test with a real purchase or paid pilot. A product that saves someone ten minutes every working day has a better basis for payment than an expanding list of chat features.

For the next trial, use five people and a two-week observation window. Proposed decision rule: continue commercial exploration only if at least three voluntarily use Lane on several separate days and can name a recurring problem it solves better than their alternative. Ask what they would actually buy; a compliment or hypothetical willingness is not a sale. This is a practical experiment threshold, not a validated market benchmark. If use remains occasional or requires coaching, improve the narrow workflow or keep Lane as a free personal project instead of expanding the feature list.
