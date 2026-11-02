const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  messages:'M4 3h16v13H9l-5 5zM8 7h8M8 11h5',
  transfer:'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4', devices:'M4 3h9v17H4zM16 7h5v13h-5M7 17h3',
  settings:'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  help:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01',
  folder:'M3 7h7l2 2h9v11H3zM3 7V4h6l2 3', plus:'M12 5v14M5 12h14',
  qr:'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h4v4h-6zM21 12h-3M12 3v4M12 12h1',
  check:'m5 12 4 4L19 6', file:'M6 2h8l4 4v16H6zM14 2v5h4M9 12h6M9 16h5',
  image:'M3 4h18v16H3zM3 16l6-6 6 6 3-3 3 3M16 8h.01', video:'M3 5h13v14H3zM16 9l5-3v12l-5-3',
  drive:'M5 4h14l3 16H2zM3 15h18M16 18h2', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',
  network:'M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0M9 16a4 4 0 0 1 6 0M12 20h.01',
  arrow:'M5 19 19 5M5 5h14v14', clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2', x:'m6 6 12 12M6 18 18 6', shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 12l3 3 5-6', pause:'M8 5v14M16 5v14'
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name] || paths.file}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
let deviceQuery = '', discoverUI, settingsSignature='';
let state, view = 'transfers', filter = 'all', query = '', selectedAddress = '', qrCache = '', loading = false, toastTimer, noticeTimer, lastNotice = '', sendSelection = null, desktopIdentity = null, desktopReady=false, encryptionProblem='';
function bytes(n) { if (!n) return '0 B'; const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4); return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`; }
function time(n) { return new Date(n).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }); }
function type(name) { return /\.(jpg|jpeg|png|heic|heif|webp|gif|avif|svg)$/i.test(name) ? 'image' : /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(name) ? 'video' : /\.pdf$/i.test(name) ? 'pdf' : 'file'; }
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000); }
async function playDesktopMessageSound(force=false) {
  if (!force && !state?.settings.messageSound) return false;
  const played=await window.LaneSound.play();
  if (!played) toast(window.LaneSound.status().error || 'Tap Test sound in Settings to activate audio.');
  return played;
}
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    state = await window.lane.snapshot();
    if (!desktopIdentity && !encryptionProblem && window.LaneCrypto) {
      try {
        const identity = await window.LaneCrypto.identity('computer:' + state.receiverId);
        if (!window.LaneCrypto.sameKey(state.computerPublicKey,identity.publicKey)) {
          await window.lane.setIdentityPublicKey(identity.publicKey);
          state = await window.lane.snapshot();
        }
        desktopIdentity=identity;window.LaneDesktopIdentity=identity;
      } catch(err) { encryptionProblem=err.message;toast(encryptionProblem); }
    }
    render(); if ($('#pair-dialog').open) await renderPair();
    if(!desktopReady){desktopReady=true;await window.lane.ready();}
  } catch (err) { toast(err.message); }
  finally { loading = false; }
}
function header(title, sub) {
  const ready = state.running && state.settings.accepting;
  return `<header class="page-header"><div><span class="eyebrow">YOUR FILES. YOUR NETWORK.</span><h1>${title}</h1><p class="subtext">${sub}</p></div><span class="network-pill"><i class="dot ${ready ? '' : 'off'}"></i>${ready ? 'Ready to receive' : state.running ? 'Receiving paused' : 'Receiver offline'}</span></header>`;
}
function render() {
  for(const conversation of state.conversations)window.LaneChat.synchronize(state.receiverId+':'+conversation.deviceId,conversation.generation);
  window.LaneTheme.apply(state.settings.theme || 'dark',false);
  const themeButton = document.querySelector('.titlebar-theme');
  if (themeButton) { const dark = document.documentElement.dataset.theme === 'dark'; themeButton.textContent = dark ? '☀️' : '🌙'; themeButton.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; themeButton.setAttribute('aria-label', themeButton.title); }
  const deviceScroll = $('.desktop-devices-list')?.scrollTop || 0;
  document.body.classList.toggle('messages-open',view === 'messages');
  const activeId = document.activeElement?.id;
  const selection = activeId && document.activeElement.selectionStart;
  const typed = ['computer-name','destination-name'].includes(activeId) ? document.activeElement.value : null;
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#nav-count').textContent = state.active.length;
  $('#requests').hidden = view === 'messages';
  const unread = (state.conversations || []).reduce((n,c) => n + c.unread,0);
  $('#message-count').textContent = unread; $('#message-count').hidden = !unread;
  const online = state.devices.filter(d => d.online);
  $('#requests').innerHTML = online.length ? `<div class="connection-strip">${icon('check')}<strong>Connected — ${online.slice(0,2).map(d=>esc(d.name)).join(', ')}${online.length > 2 ? ` + ${online.length-2} more` : ''}</strong><span class="muted">Files and messages</span><button class="button" data-view="messages">Messages</button><button class="button" data-action="send" data-device="${online[0].id}">${icon('arrow')}Send files</button></div>` : '';
  if (state.connectionNotice && state.connectionNotice.id !== lastNotice) {
    lastNotice = state.connectionNotice.id;
    if ($('#pair-dialog').open) $('#pair-dialog').close();
    showConnected(state.connectionNotice);
  }
  if (view !== 'devices' && discoverUI) { discoverUI.dispose();discoverUI=null; }
  if (view === 'messages') {
    window.DesktopMessages.render(state, header('Messages', 'Your words. Your devices. One local conversation.'));
    return;
  }
  window.DesktopMessages.leave();
  if(view==='settings') {
    const signature=JSON.stringify([state.settings,state.destinations,state.addresses,state.transport,state.running,state.startupError]);
    if($('#secure-settings') && signature===settingsSignature)return;
    settingsSignature=signature;
  }
  if(view==='devices') {
    if(!$('#desktop-discover')) {
      $('#content').innerHTML=header('Devices','Your paired devices and nearby computers, together.')+'<div class="section-heading"><h3>Nearby & connected</h3><button class="button primary" data-action="pair">Pair a new device</button></div><div id="desktop-discover"></div>';
      discoverUI=new window.LaneDiscover($('#desktop-discover'),{message:d=>{window.DesktopMessages.select(d.id);view='messages';render();},send:d=>openSend(d.id),open:d=>window.lane.openNearby(d.id).catch(err=>toast(err.message)),remove:async d=>{if(confirm(`Remove ${d.name}? This stops its transfers and requires pairing again.`)){try{await window.lane.revoke(d.id);await refresh();}catch(err){toast(err.message);}}}});
    }
    discoverUI.update(state.devices.map(d=>({...d,unread:state.conversations.find(c=>c.deviceId===d.id)?.unread || 0})),state.nearby);
    return;
  }
  $('#content').innerHTML = (state.startupError ? `<div class="startup-error">${esc(state.startupError)}</div>` : '') + (view === 'transfers' ? transfersView() : view === 'devices' ? devicesView() : settingsView());
  if(view==='settings') {
    window.LaneSecureSettings.render(state);
    $('.folder-path').closest('section').insertAdjacentHTML('afterend',destinationSettings());
    $('#secure-settings').insertAdjacentHTML('beforebegin','<section class="settings-card" id="desktop-connection-check"></section>');
    window.LaneConnection.mount($('#desktop-connection-check'),{client:'Windows',check:async()=>{const start=performance.now(),s=await window.lane.snapshot();return {client:'Windows',version:s.version,reachable:s.running,receiving:s.settings.accepting,https:s.transport.available,paired:s.devices.length>0,latencyMs:performance.now()-start};},save:text=>window.lane.saveDiagnostics(JSON.parse(text))});
    const footer=$('#content .footer-label');if(footer)$('#content').append(footer);
  }
  if ($('.desktop-devices-list')) $('.desktop-devices-list').scrollTop = deviceScroll;
  if (activeId && document.getElementById(activeId)) {
    const input = document.getElementById(activeId);
    if (typed !== null) input.value = typed;
    input.focus();
    if (typeof selection === 'number') try { input.setSelectionRange(selection, selection); } catch {}
  }
}
function transfersView() {
  const completed = state.history.filter(h => ['completed','sent'].includes(h.status));
  const total = completed.reduce((n, h) => n + h.size, 0);
  return header('Transfers', 'Send and receive. A direct line between your devices.') + `
  <div class="hero-grid"><section class="hero"><span class="eyebrow">${state.active.length ? 'FILES IN MOTION' : 'LOCAL. IN BOTH DIRECTIONS.'}</span><h2>${state.active.length ? `${state.active.length} ${state.active.length === 1 ? 'file is' : 'files are'} on the way.` : 'Your files.<br>Going both ways.'}</h2><p>Send photos, videos and documents to your phone. Receive files straight into your chosen folder.</p><div class="hero-bottom"><button class="button primary" data-action="send">${icon('arrow')}Send files</button><button class="button soft" data-action="open-folder">${icon('folder')}Open receiving folder</button></div></section><section class="pair-card"><div class="pair-icon">${icon('qr')}</div><h3>Bring a device along.</h3><p>Scan a code. Connect once.<br>Send and receive on both devices.</p><button class="button primary" data-action="pair">${icon('plus')}Pair a new device</button></section></div>
  <section class="stats"><div class="stat"><div class="stat-icon">${icon('transfer')}</div><div><strong>${completed.length}</strong><span class="label">Files transferred</span></div></div><div class="stat"><div class="stat-icon">${icon('drive')}</div><div><strong>${bytes(total)}</strong><span class="label">Transferred in saved history</span></div></div><div class="stat"><div class="stat-icon">${icon('devices')}</div><div><strong>${state.devices.length}</strong><span class="label">Paired devices</span></div></div></section>
  <div class="section-heading"><h3>Recent transfers</h3><button class="text-button" data-action="clear">Clear history</button></div><section class="transfer-box"><div class="toolbar"><div class="tabs">${[['all','All files'],['incoming','Received'],['outgoing','Sent'],['attention','Needs attention']].map(([key, name]) => `<button class="filter ${filter === key ? 'active' : ''}" data-filter="${key}">${name}</button>`).join('')}</div><label class="search">${icon('search')}<input id="search" placeholder="Find a file…" aria-label="Find a file" value="${esc(query)}"></label></div><div class="table-head"><span>FILE NAME</span><span>DEVICE</span><span>STATUS</span><span></span></div>${transferRows()}</section><div class="bottom-note">${icon('folder')}<span>Incoming files save to ${esc(state.settings.folder)}</span></div>`;
}
function transferRows() {
  const rows = state.history.filter(h => (filter === 'all' || h.direction === filter || filter === 'attention' && ['cancelled','interrupted','failed'].includes(h.status)) && h.name.toLowerCase().includes(query.toLowerCase()));
  if (!rows.length) return `<div class="empty-state"><div class="empty-graphic">${icon(query || filter !== 'all' ? 'search' : 'transfer')}</div><h3>${query || filter !== 'all' ? 'No files here just yet.' : 'Your next file lands here.'}</h3><p>${query || filter !== 'all' ? 'Try another filter or search.' : 'Pair your phone, choose a file, and watch it arrive.'}</p></div>`;
  return rows.map(h => {
    const live = state.active.find(a => a.id === h.id);
    const progress = live ? Math.min(100, live.size ? live.received / live.size * 100 : 100) : 0;
    const kind = type(h.name);
    const outgoing = h.direction === 'outgoing';
    const labels = { completed:'Received', sent:'Sent to browser', queued:'Ready to download', sending:'Sending', receiving:'Receiving', waiting:'Ready to resume', cancelled:'Cancelled', interrupted:'Interrupted', failed:'Failed' };
    const shared = state.outgoing.some(o=>o.id === h.id);
    return `<div class="transfer-row"><div class="file-cell"><div class="file-icon ${kind}">${icon(kind === 'pdf' ? 'file' : kind)}</div><div class="file-info"><div class="file-name" title="${esc(h.name)}">${esc(h.name)}</div><div class="file-meta"><span class="direction-tag ${outgoing ? 'outgoing' : ''}">${outgoing ? '↑ TO' : '↓ FROM'}</span>${bytes(h.size)} &nbsp;·&nbsp; ${live ? `${Math.round(progress)}%` : time(h.created)}</div>${live ? `<div class="progress"><span style="width:${progress}%"></span></div>` : ''}</div></div><div class="device-text" title="${esc(h.deviceName)}">${esc(h.deviceName)}</div><div><span class="badge ${h.status}" title="${esc(h.message || (outgoing ? 'Open Receive files on the paired device and tap Download.' : ''))}">${labels[h.status] || h.status}</span></div><div class="transfer-actions">${h.status === 'completed' || outgoing ? `<button class="row-action" data-action="reveal" data-id="${h.id}" title="Show in folder" aria-label="Show ${esc(h.name)} in folder">${icon('folder')}</button>` : ''}${live && !outgoing || shared ? `<button class="row-action" data-action="cancel" data-id="${h.id}" title="${outgoing ? 'Stop sharing' : 'Cancel transfer'}" aria-label="${outgoing ? 'Stop sharing' : 'Cancel'} ${esc(h.name)}">${icon('x')}</button>` : ''}</div></div>`;
  }).join('');
}
function nearbyView() {
  const nearby=state.nearby || {status:'off',computers:[]};
  return '<section class="settings-card nearby-card"><h3>Nearby Lane computers</h3><p class="subtext">'+(nearby.status==='off' ? 'Discovery is off. Enable it in Settings or scan a QR code.' : nearby.status==='unavailable' ? 'Discovery is unavailable on this network. QR pairing is still available.' : 'Discovered over your local network. Open a computer, then enter its pairing code or scan its QR code.')+'</p><div class="nearby-list">'+nearby.computers.map(peer=>'<div class="setting-row"><strong>'+esc(peer.name)+'</strong><button class="button" data-action="open-nearby" data-id="'+peer.id+'">Open to pair ↗</button></div>').join('')+(nearby.status==='searching' && !nearby.computers.length ? '<p class="subtext">Looking for other Lane computers…</p>' : '')+'</div></section>';
}
function devicesView() {
  return header('Your devices', 'Connected once. Files in both directions.') + `${nearbyView()}<div class="section-heading"><h3>${state.devices.length} paired ${state.devices.length === 1 ? 'device' : 'devices'}</h3><button class="button primary" data-action="pair">${icon('plus')}Pair a new device</button></div>` + (state.devices.length ? `<input id="device-search" class="settings-input device-search" type="search" placeholder="Find a device…" aria-label="Find a device" value="${esc(deviceQuery)}"><div class="desktop-devices-list">` + state.devices.filter(d=>d.name.toLowerCase().includes(deviceQuery.toLowerCase())).map(d => `<section class="device-card"><div class="device-icon">${icon('devices')}</div><div class="device-content"><h3>${esc(d.name)}</h3><p>${d.online ? 'Connected · Ready to send and receive' : `Last seen ${time(d.lastSeen)} · Open Lane in this device’s browser`}</p></div><div class="device-actions"><span class="badge ${d.online ? '' : 'waiting'}">${d.online ? '● Connected' : 'Paired'}</span><button class="button" data-action="message-device" data-device="${d.id}">Message</button><button class="button primary" data-action="send" data-device="${d.id}">${icon('arrow')}Send files</button><button class="button danger" data-action="revoke" data-id="${d.id}" data-name="${esc(d.name)}">Remove</button></div></section>`).join('') + '</div>' : `<section class="settings-card empty-state"><div class="empty-graphic">${icon('devices')}</div><h3>Room for your first device.</h3><p>Pair a phone, tablet or another computer using its browser.</p></section>`) + `<div class="note">Send files to a device, then open Receive files in its browser and tap Download. Removing a device stops both incoming and outgoing transfers. Existing pairings are remembered in the same browser.</div>`;
}
function destinationSettings() {
  return `<section class="settings-card"><span class="eyebrow">LESS SORTING, MORE DOING</span><h3>Project destinations</h3><p class="subtext">Let paired devices choose a named folder when sending files to this computer. All paired devices can use these destinations; only you choose the folders here.</p><div class="destination-editor"><label for="destination-name">Destination name<input id="destination-name" class="settings-input" maxlength="60" placeholder="e.g. Studio photos"></label><button class="button primary" data-action="add-destination">Choose folder & add</button></div><div class="destination-list">${(state.destinations || []).map(d=>`<div class="destination-row"><div><strong>${esc(d.name)}</strong><p>${esc(d.folder)}</p></div><button class="button" data-action="remove-destination" data-id="${d.id}" data-name="${esc(d.name)}">Remove</button></div>`).join('') || '<p class="subtext">No project folders yet. Your usual receiving folder is always available.</p>'}</div><p class="subtext">Removing a destination keeps its files. Transfers already started finish in their original folder.</p></section>`;
}
function toggle(key, label, description) {
  return `<div class="setting-row"><div><strong>${label}</strong><p class="subtext">${description}</p></div><label class="switch"><input type="checkbox" data-setting="${key}" aria-label="${label}" ${state.settings[key] ? 'checked' : ''}><span></span></label></div>`;
}
function settingsView() {
  return header('Settings', 'Make a little space for your files.') + `<section class="settings-card"><h3>Appearance</h3><div class="setting-row"><div><strong>Color theme</strong><p class="subtext">Dark mode is the default. Choose a light look or follow Windows.</p></div><select id="desktop-theme" class="settings-input" aria-label="Appearance">${[['dark','Dark'],['light','Light'],['system','Use Windows setting']].map(([value,label])=>`<option value="${value}" ${(state.settings.theme || 'dark') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></section><section class="settings-card"><h3>Receiving folder</h3><p class="subtext">Every new transfer lands here. Existing files stay where they are.</p><div class="folder-path">${esc(state.settings.folder)}</div><button class="button" data-action="choose-folder">${icon('folder')}Choose folder</button> <button class="text-button" data-action="open-folder">Open folder ↗</button></section><section class="settings-card"><h3>Your computer</h3><div class="setting-row"><div><strong>Display name</strong><p class="subtext">The name your paired devices will see.</p></div><div><input class="settings-input" id="computer-name" maxlength="60" value="${esc(state.settings.computerName)}" aria-label="Computer display name"> <button class="button" data-action="save-name">Save</button></div></div>${toggle('accepting','Receive files','Pause new uploads and incoming chunks from all devices.')}${toggle('minimizeToTray','Keep Lane in the system tray','Closing the window keeps the receiver available.')}${toggle('startAtLogin','Start with Windows','Open Lane in the background when you sign in.')}${toggle('sendToMenu','Show Lane in Windows Send to','Right-click a file → Show more options → Send to → Lane. Review the files before sending.')}${toggle('nearbyDiscovery','Discover nearby Lane computers','Announce this computer’s display name on the local network using Bonjour. Pairing still requires a code.')}${toggle('notifications','Show notifications','Notify when a device connects, a file arrives or a message is received.')}${toggle('messageSound','Play message sounds','Play a tone for messages outside the conversation you are viewing. Independent of notification banners.')}<div class="setting-row"><div><strong>Test message sound</strong><p class="subtext">Use this to confirm your speakers and browser permissions.</p></div><button class="button" data-action="test-sound">Test sound</button></div></section><section class="settings-card"><h3>Connection</h3><p class="subtext">Files are sent directly to this computer. No cloud storage, accounts or analytics.</p><div class="setting-row"><div><strong>Local address</strong><p class="subtext">${state.addresses.map(a => `${esc(a.url)} (${esc(a.name)})`).join('<br>') || 'Connect to a local Wi-Fi or Ethernet network.'}</p></div><button class="button" data-action="help">Connection help</button></div><div class="setting-row"><div><strong>${state.transport.httpsOnly ? 'HTTPS required' : 'HTTP compatibility enabled'}</strong><p class="subtext">${state.transport.httpsOnly ? 'Use the verified HTTPS address for files, pairing and messages.' : 'Upgrade your paired browsers using Secure connection below, then disable HTTP.'}</p></div><span class="badge">${state.transport.httpsOnly ? 'TLS protected' : 'Upgrade available'}</span></div></section><p class="footer-label">Lane 0.10.0 · Built for Windows · No file type restrictions<br>Coded by Max Jensen</p>`;
}
async function renderPair() {
  if (!selectedAddress || !state.addresses.find(a => a.address === selectedAddress)) selectedAddress = state.addresses[0]?.address || '';
  const pairing = state.pairing;
  const key = selectedAddress + ':' + (pairing?.code || '') + ':' + state.transport.httpsOnly;
  if (qrCache === key) return;
  qrCache = key;
  const qr = pairing && selectedAddress ? await window.lane.qr(selectedAddress) : null;
  $('#pair-content').innerHTML = `<button class="dialog-close" data-action="close-pair" aria-label="Close">×</button><div class="pair-top"><span class="eyebrow">A QUICK HELLO</span><h2 id="pair-title">Meet your computer.</h2><p>Open your phone's camera and scan this code.<br>Enter a device name on your phone to connect.</p>${state.transport.httpsOnly ? '<p class="subtext">First time using HTTPS? <button class="text-button" data-action="secure-setup">Set up this phone’s certificate</button>, then scan this pairing code.</p>' : ''}</div>${qr ? `<div class="qr-holder"><img src="${qr.image}" alt="Scan to pair with Lane"></div><div class="pair-code">${pairing.code.slice(0,3)} ${pairing.code.slice(3)}</div><p class="subtext" style="text-align:center">One-use code · expires in 5 minutes</p><div class="pair-address">${esc(state.addresses.find(a => a.address === selectedAddress).url)}<button class="button" data-action="copy-address">Copy</button></div>${state.addresses.length > 1 ? `<div class="pair-network">Network<select id="network-select" aria-label="Network adapter">${state.addresses.map(a => `<option value="${a.address}" ${a.address === selectedAddress ? 'selected' : ''}>${esc(a.name)} · ${a.address}</option>`).join('')}</select></div>` : ''}<div class="pair-steps"><span>01 &nbsp; Same network</span><span>02 &nbsp; Scan</span><span>03 &nbsp; Connected</span></div>` : `<div class="empty-state">${icon('network')}<p>${!selectedAddress ? 'Connect your computer to a local Wi-Fi or Ethernet network first.' : 'This code expired. Generate a new one.'}</p><button class="button" data-action="renew-pair">Generate code</button></div>`}`;
}
function showConnected(device) {
  clearTimeout(noticeTimer);
  const notice = $('#connected-notice');
  notice.innerHTML = `<button class="notice-close" data-action="close-notice" aria-label="Dismiss connection notification">×</button><span class="success-check">✓</span><h3>Connected — ${esc(device.name)}</h3><p>You're ready to send files and messages.</p><button class="button primary" data-action="send" data-device="${device.deviceId}">${icon('arrow')}Send files</button>`;
  notice.hidden = false;
  noticeTimer = setTimeout(()=>notice.hidden=true,10000);
}
function openSend(deviceId) {
  if (!state.devices.length) { toast('Pair a device first to send files.'); return; }
  $('#connected-notice').hidden = true;
  sendSelection = null;
  $('#send-content').innerHTML = `<button class="dialog-close" data-action="close-send" aria-label="Close">×</button><span class="eyebrow">FROM THIS COMPUTER</span><h2 id="send-title">Send files to your device.</h2><p class="subtext">Choose a device and the files you want to send.</p><div class="send-form"><label for="send-device">Send to</label><select id="send-device">${state.devices.map(d=>`<option value="${d.id}" ${d.id === deviceId ? 'selected' : ''}>${esc(d.name)}${d.online ? ' · Connected' : ' · Paired'}</option>`).join('')}</select><div id="send-selection" class="send-selection"><button class="button" data-action="choose-send-files">${icon('plus')}Choose files</button><p>Photos, videos, PDFs — any file type.</p></div><div class="send-footer"><p class="subtext">Files appear under Receive files<br>on the selected device.</p><button class="button primary" id="send-confirm" data-action="confirm-send" disabled>Send files ${icon('arrow')}</button></div></div>`;
  $('#send-dialog').showModal();
}
document.addEventListener('click', async event => {
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.view) { view = target.dataset.view; render(); return; }
  if (target.dataset.filter) { filter = target.dataset.filter; render(); return; }
  const action = target.dataset.action, id = target.dataset.id;
  try {
    if (action === 'toggle-theme') { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; await window.lane.settings({theme:next}); window.LaneTheme.apply(next); return; }
    if (action === 'secure-setup') { $('#pair-dialog').close();view='settings';render();window.LaneSecureSettings.openSetup(state); }
    if (action === 'test-sound') { const played=await playDesktopMessageSound(true);toast(played ? 'Sound played. Check your media volume if you could not hear it.' : 'Sound is blocked. Check your audio permissions.'); }
    if (action === 'pair' || action === 'renew-pair') { await window.lane.pair(); qrCache = ''; await refresh(); await renderPair(); if (!$('#pair-dialog').open) $('#pair-dialog').showModal(); }
    if (action === 'close-pair') $('#pair-dialog').close();
    if (action === 'help') $('#help-dialog').showModal();
    if (action === 'close-help') $('#help-dialog').close();
    if (action === 'send') openSend(target.dataset.device);
    if (action === 'open-nearby') await window.lane.openNearby(id);
    if (action === 'message-device') { window.DesktopMessages.select(target.dataset.device);view='messages';render(); }
    if (action === 'close-send') $('#send-dialog').close();
    if (action === 'close-notice') $('#connected-notice').hidden = true;
    if (action === 'choose-send-files') {
      const selected = await window.lane.chooseFiles();
      if (selected) {
        sendSelection = selected;
        $('#send-selection').innerHTML = `<ul class="send-file-list">${selected.files.map(f=>`<li><span>${esc(f.name)}</span><small>${bytes(f.size)}</small></li>`).join('')}</ul><button class="text-button" data-action="choose-send-files">Choose different files</button>`;
        $('#send-confirm').disabled = false;
      }
    }
    if (action === 'confirm-send' && sendSelection) {
      target.disabled = true;
      try {
        const deviceId = $('#send-device').value;
        const offers = await window.lane.sendFiles(deviceId,sendSelection.selectionId);
        $('#send-dialog').close();
        toast(`${offers.length} ${offers.length === 1 ? 'file' : 'files'} ready on ${state.devices.find(d=>d.id === deviceId)?.name || 'your device'}. Tap Receive files there.`);
      } catch (err) { target.disabled = false; throw err; }
    }
    if (action === 'revoke' && confirm(`Remove ${target.dataset.name}? This stops its transfers, deletes its message history on the computer and requires pairing again.`)) await window.lane.revoke(id);
    if (action === 'cancel') await window.lane.cancel(id);
    if (action === 'clear' && confirm('Clear completed transfer history? Your received files will stay in their folders.')) await window.lane.clearHistory();
    if (action === 'choose-folder') { await window.lane.chooseFolder(); toast('Receiving folder updated.'); }
    if (action === 'add-destination') {const name=$('#destination-name').value.trim();if(!name)throw new Error('Enter a name for this destination.');target.disabled=true;try{const result=await window.lane.addDestination(name);if(result){$('#destination-name').value='';toast('Destination added. Paired devices can now choose it.');}}finally{target.disabled=false;}}
    if (action === 'remove-destination' && confirm(`Remove ${target.dataset.name} from destinations? Existing files and transfers are kept.`))await window.lane.removeDestination(id);
    if (action === 'open-folder') await window.lane.openFolder();
    if (action === 'reveal') await window.lane.reveal(id);
    if (action === 'save-name') { await window.lane.settings({ computerName: $('#computer-name').value }); $('#computer-name').blur(); toast('Computer name saved.'); }
    if (action === 'copy-address') { await window.lane.copyAddress(selectedAddress); toast('Local address copied.'); }
    if (action && !['help','close-help','close-pair'].includes(action)) await refresh();
  } catch (err) { toast(err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
});
document.addEventListener('input', event => { if (event.target.id === 'device-search') { deviceQuery=event.target.value;render(); } if (event.target.id === 'search') { query = event.target.value; render(); } });
document.addEventListener('change', async event => {
  try {
    if (event.target.id === 'desktop-theme') await window.lane.settings({theme:event.target.value});
    if (event.target.dataset.setting) await window.lane.settings({ [event.target.dataset.setting]: event.target.checked });
    if (event.target.id === 'network-select') { selectedAddress = event.target.value; await renderPair(); }
  } catch (err) { toast(err.message); }
  await refresh();
});
window.lane.onChanged(refresh);

window.lane.onMessage(device => { if(device.silent)return; if (state?.settings.notifications !== false) toast(`New message from ${device.name}`); playDesktopMessageSound(); });
window.lane.onLaunchAction(async request=>{
  if(request.error){toast(request.error);return;}
  if(request.action==='messages'){view='messages';render();}
  if(request.action==='pair'){await window.lane.pair();qrCache='';await refresh();await renderPair();if(!$('#pair-dialog').open)$('#pair-dialog').showModal();}
  if(request.action==='send'){
    if(!state.devices.length){toast('Pair a device first, then send the files again.');return;}
    openSend();
    if(request.selection){sendSelection=request.selection;$('#send-selection').innerHTML='<ul class="send-file-list">'+sendSelection.files.map(f=>'<li><span>'+esc(f.name)+'</span><small>'+bytes(f.size)+'</small></li>').join('')+'</ul>';$('#send-confirm').disabled=false;}
  }
});
window.lane.onOpenMessages(deviceId => { window.DesktopMessages.select(deviceId); view = 'messages'; refresh(); });
setInterval(refresh, 5000);
refresh();
