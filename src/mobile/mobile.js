const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let info, token = '', storageKey, queue = [], sending = false, pairing = false, inbox = [], toastTimer, receivedIds = new Set(), pairAttempt = '', phoneIdentity = null;
let chat, messageDevice = '', messageNoticeIds = new Set();
let messageSequence=null, healthBusy=false;
let localDevices = [], messagePeer = 'computer', latestDevice, deviceQuery = '', directoryCache = '', latestBatch = '';
const chats = new Map();
let discoverUI, currentTab='send', previousTab='send';
// Keep the existing tab controller while presenting discovery inside Devices.
$('#discover-tab').hidden=true;
for(const child of [...$('#devices-panel').children])child.hidden=true;
$('#devices-panel').append($('#mobile-discover'));
$('#relay-hint').insertAdjacentHTML('beforebegin','<div id="destination-control"><label for="file-destination">Save in</label><select id="file-destination"><option value="default">Receiving folder</option></select></div>');
function updateDestinations(device) {
  const select=$('#file-destination');
  let selected=select.value || 'default';
  if(!select.dataset.loaded){try{selected=localStorage.getItem('lane-destination:'+info.receiverId) || 'default';}catch{}select.dataset.loaded='true';}
  const destinations=device.destinations || [{id:'default',name:'Receiving folder'}];
  const html=destinations.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
  if(select.innerHTML!==html){select.innerHTML=html;select.value=destinations.some(d=>d.id===selected) ? selected : 'default';}
}
$('#file-destination').addEventListener('change',()=>{try{localStorage.setItem('lane-destination:'+info.receiverId,$('#file-destination').value);}catch{}renderQueue();});
$('#settings-panel').insertAdjacentHTML('beforeend','<section class="mobile-settings" id="phone-connection-check"></section>');
window.LaneConnection.mount($('#phone-connection-check'),{client:'Browser',check:async()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000),start=performance.now();
  try{const server=await api('/api/info',{signal:controller.signal});let paired=false;if(token){try{await api('/api/device',{signal:controller.signal});paired=true;}catch(err){if(err.status!==401)throw err;}}
    return {client:'Browser',version:server.version,reachable:true,receiving:server.accepting,https:location.protocol==='https:',secureContext:isSecureContext,paired,screenWakeLock:isSecureContext && typeof navigator.wakeLock?.request==='function',latencyMs:performance.now()-start};
  }finally{clearTimeout(timer);}
}});
document.addEventListener('paste',event=>{if(currentTab!=='send' || !token || event.target.closest('input,textarea,[contenteditable]'))return;const files=Array.from(event.clipboardData?.files || []);if(files.length){event.preventDefault();addFiles(files);}});
$('#drop-zone').insertAdjacentHTML('beforeend','<p class="paste-hint">You can also paste copied files or images here if your browser supports it. Review them before sending.</p>');
$('.queue-heading').insertAdjacentHTML('beforeend','<button id="retry-failed" type="button" hidden>Retry failed</button>');
$('#retry-failed').addEventListener('click',()=>{for(const item of queue)if(item.status==='failed' && item.file){item.cancelled=false;item.status='queued';item.error='';}renderQueue();pump();});
const pairingParams=new URLSearchParams(location.hash.slice(1));
const code = pairingParams.get('code'), expectedComputerKey=pairingParams.get('key');
if (code) { $('#pair-code').value = code; history.replaceState(null, '', location.pathname); }
$('#device-name').value = /iPhone/.test(navigator.userAgent) ? 'My iPhone' : /iPad/.test(navigator.userAgent) || /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1 ? 'My iPad' : /Android/.test(navigator.userAgent) ? 'My Android' : /Windows/.test(navigator.userAgent) ? 'My Windows PC' : /Mac/.test(navigator.userAgent) ? 'My Mac' : 'My device';
try { $('#device-name').value = localStorage.getItem('lane-device-name') || $('#device-name').value; } catch {}
function bytes(n) { if (!n) return '0 B'; const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4); return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${['B','KB','MB','GB','TB'][i]}`; }
function identifier() {
  const bytes = new Uint8Array(20); crypto.getRandomValues(bytes);
  return [...bytes].map(n => n.toString(16).padStart(2,'0')).join('');
}
async function api(route, options = {}) {
  const response = await fetch(route, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Lane-Tablet':navigator.maxTouchPoints>1 && /Macintosh/.test(navigator.userAgent) ? '1' : '0',...(options.body ? { 'Content-Type':'application/json' } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'Could not connect. Try again.'), { status: response.status });
  return body;
}
function message(text, failure = false) { $('#pair-message').textContent = text; $('#pair-message').classList.toggle('error', failure); }
function setConnected(connected) {
  $('#pair-section').hidden = connected || currentTab==='settings'; $('#sender-section').hidden = !connected || currentTab==='settings';
  $('#device-name-setting').hidden=!connected;
  if (!connected) { for (const c of chats.values()) c.dispose(); chats.clear(); chat = null; messageDevice = ''; $('#mobile-chat').innerHTML = ''; $('#phone-message-count').textContent = '0'; }
  if (connected) { $('#connected-title').textContent = `Connected — ${info?.name || 'your computer'}`; window.scrollTo(0,0); }
}
function soundEnabled() { try { return localStorage.getItem('lane-message-sound') === 'true'; } catch { return false; } }
function alertsEnabled() { try { return localStorage.getItem('lane-message-alerts') !== 'false'; } catch { return true; } }
async function playMessageSound(force=false) {
  if (!force && !soundEnabled()) return false;
  const played=await window.LaneSound.play();
  if (!played && soundEnabled()) notify('Audio needs attention. Open Settings → Test sound.');
  return played;
}
function notify(text) { if (!alertsEnabled()) return; clearTimeout(toastTimer); $('#mobile-toast').textContent=text;$('#mobile-toast').hidden=false;toastTimer=setTimeout(()=>$('#mobile-toast').hidden=true,6000); }
function noticeMessages(events) {
  const latest=events.reduce((max,m)=>Math.max(max,m.seq),0);
  if (messageSequence!==null) {
    const incoming=events.filter(m=>m.seq>messageSequence && !window.LaneChat.isMuted(info.receiverId+':'+messageDevice+(m.senderId==='computer' ? '' : ':'+m.senderId)) && !(!document.hidden && document.hasFocus() && !$('#messages-panel').hidden && m.senderId===messagePeer));
    if (incoming.length) { notify(incoming.length===1 ? 'New message from '+incoming[0].senderName : incoming.length+' new messages. Open Messages to reply.');void playMessageSound();vibrateMessage(); }
  }
  messageSequence=Math.max(messageSequence || 0,latest);
}
function showTab(tab) {
  if(tab==='discover')tab='devices';
  if(tab==='settings' && currentTab!=='settings')previousTab=currentTab;
  currentTab=tab;
  $('#settings-panel').hidden=tab!=='settings';
  $('#mobile-settings-toggle').setAttribute('aria-pressed',String(tab==='settings'));
  $('#sender-section').hidden=tab==='settings' || !token;
  $('#pair-section').hidden=tab==='settings' || Boolean(token);
  $('#device-name-setting').hidden=!token;
  document.body.classList.toggle('mobile-messages',tab === 'messages');
  for (const name of ['send','receive','messages','discover','devices']) {
    const selected = name === tab;
    $('#' + name + '-tab').classList.toggle('selected',selected);
    $('#' + name + '-tab').setAttribute('aria-selected',String(selected));
    $('#' + name + '-panel').hidden = !selected;
  }
  if (tab === 'messages') chat?.tick();
  if(tab==='settings')window.scrollTo(0,0);
}
$('#mobile-settings-toggle').addEventListener('click',()=>showTab(currentTab==='settings' ? previousTab : 'settings'));
$('#close-mobile-settings').addEventListener('click',()=>showTab(previousTab));
$('#send-tab').addEventListener('click',()=>showTab('send'));
$('#receive-tab').addEventListener('click',()=>{showTab('receive');health();});
$('#messages-tab').addEventListener('click',()=>{showTab('messages');health();});
$('#discover-tab').addEventListener('click',()=>{showTab('discover');health();});
$('#devices-tab').addEventListener('click',()=>{showTab('devices');health();});
async function messageApi(route, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try { return await api(route, { ...options, signal:controller.signal }); } finally { clearTimeout(timer); }
}
function setupMessages(device) {
  latestDevice = device;
  if (messageDevice !== device.id) {
    for (const c of chats.values()) c.dispose(); chats.clear(); $('#mobile-chat').innerHTML = '';
    messageDevice = device.id; messageNoticeIds = new Set();
  }
  localDevices = device.devices || [{id:'computer',name:device.computerName,online:true,unread:0}];
  for(const peer of localDevices)window.LaneChat.synchronize(info.receiverId+':'+device.id+(peer.id==='computer' ? '' : ':'+peer.id),peer.generation);
  if (!localDevices.some(d=>d.id === messagePeer)) messagePeer = 'computer';
  renderDirectory();
  if(!discoverUI) discoverUI=new window.LaneDiscover($('#mobile-discover'),{message:d=>{messagePeer=d.id;setupMessages(latestDevice);showTab('messages');},send:d=>{$('#file-recipient').value=d.id;showTab('send');renderQueue();notify('Choose files, review your selection, then tap Send.');},open:d=>window.open(d.url,'_blank','noopener,noreferrer')});
  discoverUI.update(localDevices,device.nearby);
  for (const [id,c] of chats) {
    const peer = localDevices.find(d=>d.id === id);
    if (!peer) { c.dispose(); c.root.remove(); chats.delete(id); continue; }
    c.root.hidden = id !== messagePeer; c.options.secure=Boolean(peer.publicKey);c.updatePeer(peer.name,peer.online);
  }
  const peer = localDevices.find(d=>d.id === messagePeer);
  if (!chats.has(messagePeer)) {
    const peerId = messagePeer, element = document.createElement('div'); element.className = 'chat-root'; $('#mobile-chat').append(element);
    const instance = new window.LaneChat(element, {
      key:info.receiverId + ':' + device.id + (peerId === 'computer' ? '' : ':' + peerId), viewerId:device.id, peer:peer.name, online:peer.online, direction:'outgoing', canRead:()=>document.hasFocus(),secure:Boolean(phoneIdentity && peer.publicKey), securityCode:peer.publicKey ? window.LaneCrypto.fingerprint(phoneIdentity.publicKey,peer.publicKey) : '',
      fetch:(revision,limit) => messageApi(`/api/messages?peer=${peerId}&revision=${revision}&limit=${limit}`),
      send:body => messageApi('/api/messages',{method:'POST',body:JSON.stringify({...body,recipientId:peerId})}),
      ack:body => messageApi('/api/messages/ack',{method:'POST',body:JSON.stringify(body)}),
      encrypt: body => window.LaneCrypto.encrypt(body,phoneIdentity,localDevices.find(d=>d.id===peerId)?.publicKey,{scope:info.receiverId,viewerId:device.id,peerId}),
      decrypt: message => window.LaneCrypto.decrypt(message,phoneIdentity,localDevices.find(d=>d.id===peerId)?.publicKey,{scope:info.receiverId,viewerId:device.id,peerId}),
      react:(m,emoji) => messageApi(`/api/messages/${m.id}/reaction`,{method:'POST',body:JSON.stringify({emoji})}),
      onUpdate:() => {}
    });
    chats.set(peerId,instance);
  }
  chat = chats.get(messagePeer);
  const unread = localDevices.reduce((n,d)=>n+d.unread,0);
  $('#phone-message-count').textContent = unread;

  if (document.activeElement !== $('#my-device-name')) $('#my-device-name').value = device.name;
}
function renderDirectory() {
  const scroll = $('#mobile-devices-list').scrollTop;
  const signature = JSON.stringify(localDevices);
  if (signature !== directoryCache) {
    directoryCache = signature;
    for (const selector of ['#file-recipient','#chat-recipient']) {
      const el = $(selector), selected = selector === '#chat-recipient' ? messagePeer : el.value || 'computer';
      el.innerHTML = localDevices.map(d=>`<option value="${d.id}">${esc(d.name)}${d.id === 'computer' ? ' · Computer' : d.online ? ' · Connected' : ' · Offline'}${d.unread ? ` · ${d.unread} unread` : ''}</option>`).join('');
      el.value = localDevices.some(d=>d.id === selected) ? selected : 'computer';
    }
  }
  $('#chat-recipient').value = messagePeer;
  $('#mobile-devices-list').innerHTML = localDevices.filter(d=>d.name.toLowerCase().includes(deviceQuery.toLowerCase())).map(d=>`<article class="mobile-device"><span class="device-avatar">${d.id === 'computer' ? '▱' : '◌'}</span><div><strong>${esc(d.name)}</strong><small>${d.online ? '● Connected' : '○ Offline · delivery will wait'}</small><div class="mobile-device-actions"><button data-message-device="${d.id}">Message${d.unread ? ' · '+d.unread : ''}</button><button data-send-device="${d.id}">Send files</button></div></div></article>`).join('') || '<p class="subtext">No matching devices.</p>';
  $('#mobile-devices-list').scrollTop = scroll;
}
$('#chat-recipient').addEventListener('change',event=>{messagePeer=event.target.value;setupMessages(latestDevice);chat.tick();});
$('#mobile-device-search').addEventListener('input',event=>{deviceQuery=event.target.value;renderDirectory();});
$('#mobile-devices-list').addEventListener('click',event=>{const button=event.target.closest('button'); if(!button)return; if(button.dataset.messageDevice){messagePeer=button.dataset.messageDevice;setupMessages(latestDevice);showTab('messages');} if(button.dataset.sendDevice){$('#file-recipient').value=button.dataset.sendDevice;showTab('send');renderQueue();notify('Choose your files, review the selection, then tap Send.');}});
$('#save-device-name').addEventListener('click',async()=>{try{await api('/api/device',{method:'PATCH',body:JSON.stringify({name:$('#my-device-name').value})});try{localStorage.setItem('lane-device-name',$('#my-device-name').value.trim());}catch{}notify('Device name saved.');await health();}catch(err){notify(err.message);}});
$('#clear-phone-conversation').addEventListener('click',async()=>{if(!confirm(window.LaneChat.clearPrompt))return;const target=chat,peer=messagePeer;try{const result=await api('/api/messages?peer='+peer,{method:'DELETE'});target.purge(result.generation);await target.tick();}catch(err){notify(err.message);}});
$('#mobile-theme').value=window.LaneTheme.mode();
$('#mobile-theme').addEventListener('change',event=>window.LaneTheme.apply(event.target.value));
function updateThemeToggle() { const dark = document.documentElement.dataset.theme === 'dark'; const button = $('#mobile-theme-toggle'); if (button) { button.textContent = dark ? '☀️' : '🌙'; button.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; button.setAttribute('aria-label',button.title); } }
window.addEventListener('lane:theme', ()=>{updateThemeToggle();$('#mobile-theme').value=window.LaneTheme.mode();});
$('#mobile-theme-toggle').addEventListener('click',()=>window.LaneTheme.apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
updateThemeToggle();
try { $('#mobile-message-alerts').checked = alertsEnabled(); $('#mobile-message-sound').checked = soundEnabled(); } catch {}
$('#mobile-message-alerts').addEventListener('change', event => { try { localStorage.setItem('lane-message-alerts',String(event.target.checked)); } catch {} notify(event.target.checked ? 'Message alerts enabled.' : 'Message alerts muted.'); });
function soundResult(played){const status=window.LaneSound.status();$('#mobile-sound-result').textContent=played ? 'Audio started. If silent, check media volume, Silent Mode and audio output below.' : (status.error || 'Audio could not start.')+' State: '+status.state+'.';}
$('#mobile-message-sound').addEventListener('change', async event => { const enabled=event.target.checked;try { localStorage.setItem('lane-message-sound',String(enabled)); } catch {} if(enabled)soundResult(await playMessageSound(true));else $('#mobile-sound-result').textContent='Message sounds are off. Test sound still works.'; });
$('#mobile-test-sound').addEventListener('click', async () => soundResult(await playMessageSound(true)));
$('#mobile-reset-sound').addEventListener('click', async () => soundResult(await window.LaneSound.reset()));
const vibrationSupported=typeof navigator.vibrate==='function';
$('#mobile-message-vibration').disabled=!vibrationSupported;
$('#mobile-test-vibration').hidden=!vibrationSupported;
try{$('#mobile-message-vibration').checked=vibrationSupported && localStorage.getItem('lane-message-vibration')==='true';}catch{}
$('#mobile-vibration-result').textContent=vibrationSupported ? 'Available in this browser. Vibration depends on device settings and usually requires Lane to be visible.' : 'This browser does not support website vibration. Safari on iPhone cannot vibrate for incoming Lane messages, including in Silent Mode.';
$('#mobile-message-vibration').addEventListener('change',event=>{try{localStorage.setItem('lane-message-vibration',String(event.target.checked));}catch{}if(event.target.checked)vibrateMessage();});
function vibrateMessage(force=false){if(!vibrationSupported || document.hidden || !force && !$('#mobile-message-vibration').checked)return false;try{return navigator.vibrate([120,60,120]);}catch{return false;}}
$('#mobile-test-vibration').addEventListener('click',()=>{$('#mobile-vibration-result').textContent=vibrateMessage(true) ? 'Vibration requested. Your device decides whether to vibrate.' : 'The browser declined vibration. Keep Lane visible and check device settings.';});
$('#refresh-inbox').addEventListener('click',health);
function renderInbox(files) {
  const changed = JSON.stringify(inbox) !== JSON.stringify(files);
  const newFiles = files.filter(f=>!receivedIds.has(f.id));
  for (const file of files) receivedIds.add(file.id);
  inbox = files;
  $('#inbox-count').textContent = files.length;
  if (newFiles.length) notify(`${newFiles.length} ${newFiles.length === 1 ? 'file is' : 'files are'} ready. Tap Receive files to download.`);
  if (!changed && $('#inbox').children.length) return;
  $('#inbox').innerHTML = files.length ? files.map(file => {
    const extension = (file.name.split('.').length > 1 ? file.name.split('.').pop() : 'FILE').slice(0,4).toUpperCase();
    return `<article class="inbox-file"><div class="inbox-file-top"><div class="file-icon">${esc(extension)}</div><div class="file-details"><div class="file-name" title="${esc(file.name)}">${esc(file.name)}</div><div class="file-meta">${bytes(file.size)} · From ${esc(file.senderName || 'your computer')} · ${file.status === 'sent' ? 'Sent to this browser · download again anytime' : file.status === 'sending' ? 'Downloading…' : 'Ready to download'}</div></div></div><div class="inbox-actions"><a class="download" href="/download/${file.id}" download="${esc(file.name)}" data-download="${file.id}">↓ Download</a>${file.preview ? `<a class="open" href="/download/${file.id}?preview=1" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ''}</div></article>`;
  }).join('') : '<div class="inbox-empty"><span>↓</span><strong>No files waiting yet.</strong><p>Choose this device when sending files from Lane on the computer or another paired device. They will appear here automatically.</p></div>';
}
$('#inbox').addEventListener('click',event=>{
  const link = event.target.closest('[data-download]'); if (!link) return;
  $('#download-message').textContent = 'Your browser handles this download. Check its download indicator, then open the file in Files or save supported media to Photos.';
});
function forget() {
  fetch('/api/logout',{method:'POST'}).catch(()=>{});
  if (storageKey) try { localStorage.removeItem(storageKey); } catch {}
  token = ''; setConnected(false);
}
async function health() {
  if (!token || healthBusy) return;
  healthBusy=true;
  try {
    const device = await api('/api/device');
    if (!window.LaneCrypto.sameKey(device.publicKey,phoneIdentity.publicKey)) { await api('/api/device/key',{method:'POST',body:JSON.stringify({publicKey:phoneIdentity.publicKey})});device.publicKey=phoneIdentity.publicKey; }
    window.LaneCrypto.pin(info.receiverId,'computer',device.computerPublicKey);
    noticeMessages(device.messageEvents || []);
    const nearby=device.nearby || {computers:[]};
    $('#mobile-nearby').innerHTML='<h2>Nearby Lane computers</h2><p>Found by this computer. Open another Lane receiver and use its pairing code.</p>'+nearby.computers.map(p=>'<p><a href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">'+esc(p.name)+' ↗</a></p>').join('')+(!nearby.computers.length ? '<p>No other Lane computers found. QR pairing is always available.</p>' : '');
    setupMessages(device);
    updateDestinations(device);
    renderSent(device.sent || []);
    $('#receiver-name').textContent = device.computerName;
    $('#connected-title').textContent = `Connected — ${device.computerName}`;
    renderInbox(device.inbox || []);
    $('#connection-status').textContent = device.accepting ? 'Connected' : 'Paused';
    $('#connection-status').classList.toggle('offline', !device.accepting);
    $('#connection-warning').hidden = device.accepting;
    $('#connection-warning').textContent = 'Receiving is paused on your computer. Resume it in Lane, then retry any waiting transfers.';
  } catch (err) {
    if (err.status === 401) { forget(); message('This device is no longer paired. Open Lane on your computer to pair again.', true); }
    else {
      for (const c of chats.values()) c.updatePeer(c.root.querySelector('.chat-peer').textContent,false);
      $('#connection-status').textContent = 'Offline'; $('#connection-status').classList.add('offline');
      $('#connected-title').textContent = 'Computer is offline';
      $('#connection-warning').hidden = false;
      $('#connection-warning').textContent = err.message || 'The computer is not reachable. Check the network and keep Lane running.';
    }
  } finally { healthBusy=false; }
}
async function init() {
  try {
    info = await api('/api/info');
    $('#transport-status').textContent=info.secure ? 'HTTPS connection · verify Safari shows no certificate warning. Message bodies encrypted end to end.' : 'HTTP compatibility · files and pairing are not encrypted in transit. Upgrade to HTTPS in Settings → Recovery & HTTPS.';
    $('#mobile-connection-summary').textContent=info.secure ? 'Using HTTPS. Lane cannot tell whether a certificate warning was bypassed: check the browser before sharing sensitive content.' : 'HTTP compatibility is enabled. Use HTTPS to protect files, pairing and the page itself.';
    const certificate=info.certificate;
    $('#mobile-connection-details').innerHTML='<dt>Current address</dt><dd>'+esc(location.origin)+'</dd><dt>Browser secure context</dt><dd>'+(window.isSecureContext ? 'Available' : 'Unavailable')+'</dd>'+(certificate ? '<dt>Certificate authority</dt><dd>'+esc(certificate.name)+'</dd><dt>Root SHA-256 · compare with the computer</dt><dd><code>'+esc(certificate.fingerprint)+'</code></dd><dt>Server certificate valid until</dt><dd>'+esc(new Date(certificate.expires).toLocaleString())+'</dd><dt>Server SHA-256</dt><dd><code>'+esc(certificate.serverFingerprint)+'</code></dd><dt>Valid server addresses</dt><dd>'+esc(certificate.hosts)+'</dd>' : '');
    window.LaneRecovery.mountMobile(info); storageKey = 'lane:' + info.receiverId;
    phoneIdentity = await window.LaneCrypto.identity('phone:' + info.receiverId);
    if (expectedComputerKey && expectedComputerKey!==info.computerPublicKey?.x+'.'+info.computerPublicKey?.y) throw new Error('The computer key does not match the QR code. Scan a fresh code directly from Lane.');
    window.LaneCrypto.pin(info.receiverId,'computer',info.computerPublicKey);
    $('#pair-computer').textContent = info.name; $('#receiver-name').textContent = info.name;
    try { token = localStorage.getItem(storageKey) || ''; } catch {}
    if (token) { setConnected(true); await health(); }
  } catch (err) { message(err.message || 'Keep Lane running and reload this page.', true); }
}
$('#pair-form').addEventListener('submit', async event => {
  event.preventDefault(); if (pairing) return;
  pairing = true; $('#pair-button').disabled = true;
  try {
    if (!info) await init();
    pairAttempt ||= identifier();
    const result = await api('/api/pair/request', { method:'POST', body:JSON.stringify({ code:$('#pair-code').value.trim(), name:$('#device-name').value.trim(), clientId:pairAttempt, publicKey:phoneIdentity?.publicKey }) });
    if (!result.token) throw new Error('Restart Lane on your computer to finish updating, then reload this page.');
    token = result.token;
    try { localStorage.setItem('lane-device-name',$('#device-name').value.trim()); } catch {}
    try { localStorage.setItem(storageKey, token); } catch {}
    setConnected(true); showTab('send'); await health(); message('');
    notify(`Connected — ${info.name}. Choose files, messages or another device.`);
    pairAttempt = '';
  } catch (err) { message(err.message, true); }
  finally { pairing = false; $('#pair-button').disabled = false; }
});
function addFiles(files) {
  if (queue.filter(q=>q.status === 'selected').length + files.length > 100) { notify('Choose up to 100 files in one batch. Send the current selection first.'); return; }
  if (!sending) { latestBatch='';$('#upload-result').hidden=true; }
  for (const file of files) queue.push({ localId:identifier(), clientId:identifier(), file, name:file.name, status:'selected', offset:0, displayOffset:0, id:null, cancelled:false, error:'' });
  renderQueue();
  if (files.length) { notify('Files selected. Review them, then tap Send.'); $('#send-review').scrollIntoView({block:'nearest',behavior:'smooth'}); }
}
$('#send-selected').addEventListener('click',()=>{
  const selected=queue.filter(q=>q.status === 'selected'); if(!selected.length)return;
  const recipient=localDevices.find(d=>d.id === $('#file-recipient').value);
  if(!recipient){notify('Choose an available paired device.');return;}
  latestBatch=identifier();
  for(const item of selected){item.recipientId=recipient.id;item.recipientName=recipient.name;item.destinationId=recipient.id==='computer' ? $('#file-destination').value : 'default';item.destinationName=recipient.id==='computer' ? $('#file-destination').selectedOptions[0]?.textContent : 'Receiving folder';item.batch=latestBatch;item.status='queued';}
  renderQueue();renderBatch();pump();
});
$('#file-recipient').addEventListener('change',renderQueue);
$('#selection-files').addEventListener('click',event=>{const button=event.target.closest('[data-remove-selected]');if(!button)return;queue=queue.filter(q=>q.localId !== button.dataset.removeSelected || q.status !== 'selected');renderQueue();});
function renderBatch() {
  const batch=queue.filter(q=>q.batch === latestBatch); if(!batch.length)return;
  const done=batch.filter(q=>q.status === 'completed').length, failed=batch.filter(q=>['failed','cancelled'].includes(q.status)).length;
  const settled=done+failed === batch.length, destination=(batch[0].recipientName || 'your computer')+(batch[0].recipientId==='computer' ? ' / '+(batch[0].destinationName || 'Receiving folder') : '');
  const result=$('#upload-result');result.hidden=false;result.classList.toggle('has-errors',Boolean(failed));
  result.innerHTML=`<span>${settled && !failed ? '✓' : failed ? '!' : '↑'}</span><div><strong>${settled ? failed ? `${done} of ${batch.length} files sent` : `Sent — ${done} ${done === 1 ? 'file' : 'files'}` : `Sending ${done} of ${batch.length} files…`}</strong><p>${settled && !failed ? batch[0].recipientId === 'computer' ? `Saved to ${esc(destination)}.` : `Ready on ${esc(destination)}. Open Receive files there to download.` : failed ? 'Some files need attention. Use Retry below.' : `To ${esc(destination)} · Keep this page open.`}</p></div>`;
  if(settled && !failed && renderBatch.notified !== latestBatch){renderBatch.notified=latestBatch;notify(`Sent — ${done} ${done === 1 ? 'file' : 'files'} to ${destination}.`);}
}
function renderSent(files) {
  $('#sent-section').hidden=!files.length;
  const html=files.map(f=>`<div class="sent-file"><span>✓</span><div><strong>${esc(f.name)}</strong><small>${bytes(f.size)} · ${f.status === 'saved' ? 'Saved to ' : f.status === 'downloaded' ? 'Downloaded by ' : f.status === 'unavailable' ? 'Sharing ended · ' : 'Ready for '}${esc(f.recipientName)}</small></div></div>`).join('');
  if($('#sent-history').innerHTML !== html)$('#sent-history').innerHTML=html;
}
$('#file-input').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
$('#photo-input').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
$('#camera-input').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
$('#choose-photos').addEventListener('click',()=>$('#photo-input').click());
$('#choose-files').addEventListener('click',()=>$('#file-input').click());
$('#take-photo').addEventListener('click',()=>$('#camera-input').click());
const drop = $('#drop-zone');
drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragging'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragging'); addFiles(event.dataTransfer.files); });
function renderQueue() {
  $('#retry-failed').hidden=!queue.some(item=>item.status==='failed' && item.file);
  const selected=queue.filter(q=>q.status === 'selected');
  $('#send-review').hidden=!selected.length;
  $('#selection-summary').textContent=`${selected.length} ${selected.length === 1 ? 'file' : 'files'} ready to send`;
  $('#selection-size').textContent=bytes(selected.reduce((n,q)=>n+q.file.size,0))+' in your selection';
  $('#selection-files').innerHTML=selected.map(item=>`<div class="selection-file"><span>${esc((item.name.split('.').pop() || 'FILE').slice(0,4).toUpperCase())}</span><div><strong title="${esc(item.name)}">${esc(item.name)}</strong><small>${bytes(item.file.size)}</small></div><button type="button" data-remove-selected="${item.localId}" aria-label="Remove ${esc(item.name)} from selection">×</button></div>`).join('');
  $('#send-selected').innerHTML=`Send ${selected.length} ${selected.length === 1 ? 'file' : 'files'} <span>↑</span>`;
  $('#relay-hint').textContent=$('#file-recipient').value === 'computer' ? 'Files save to your computer’s receiving folder.' : 'Files pass through the computer. A copy stays in its receiving folder; the recipient downloads from Receive files.';
  $('#destination-control').hidden=$('#file-recipient').value!=='computer';
  if($('#file-recipient').value==='computer')$('#relay-hint').textContent='Files save in '+($('#file-destination').selectedOptions[0]?.textContent || 'Receiving folder')+' on your computer. Review the destination before sending.';
  const transfers=queue.filter(q=>q.status !== 'selected');
  $('.queue-section').hidden=!transfers.length;
  $('#queue-count').textContent = transfers.length;
  $('#queue').innerHTML = transfers.length ? transfers.map(item => {
    const size = item.file?.size ?? item.size;
    const percentage = size ? Math.min(100, item.displayOffset / size * 100) : item.status === 'completed' ? 100 : 0;
    const status = item.status === 'selected' ? `Ready to send · ${bytes(size)}` : item.status === 'completed' ? item.recipientId && item.recipientId !== 'computer' ? `Ready on ${item.recipientName}` : 'Sent · Saved to computer' : item.status === 'failed' ? item.error : item.status === 'cancelled' ? 'Cancelled' : item.status === 'sending' ? `${Math.floor(percentage)}% · ${bytes(item.displayOffset)} of ${bytes(size)}` : item.status === 'finishing' ? 'Saving and preparing delivery…' : 'Waiting to send';
    const extension = (item.name.split('.').length > 1 ? item.name.split('.').pop() : 'FILE').slice(0,4).toUpperCase();
    return `<div class="queue-row"><div class="file-icon">${esc(extension)}</div><div class="file-details"><div class="file-name" title="${esc(item.name)}">${esc(item.name)}</div><div class="file-meta ${item.status === 'failed' ? 'error' : ''}">${esc(status)}${item.status === 'completed' ? ' · ' + bytes(size) : ''}</div>${['sending','finishing'].includes(item.status) ? `<progress class="native-progress" max="100" value="${percentage}">${Math.floor(percentage)}%</progress>` : ''}</div>${item.status === 'completed' ? '<span class="file-action done">✓</span>' : ['failed','cancelled'].includes(item.status) ? `<button class="file-action" data-retry="${item.localId}" aria-label="Retry ${esc(item.name)}">Retry</button>` : `<button class="file-action" data-cancel="${item.localId}" aria-label="Cancel ${esc(item.name)}">×</button>`}</div>`;
  }).join('') : '<div class="queue-empty">Your files will appear here as you send them.</div>';
  renderBatch();
}
function sendChunk(item, start, end) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); item.xhr = xhr;
    xhr.open('PUT', '/api/uploads/' + item.id);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('X-File-Offset', String(start));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.timeout = 120000;
    let rendered = 0;
    xhr.upload.onprogress = event => { item.displayOffset = start + event.loaded; if (Date.now() - rendered > 120) { renderQueue(); rendered = Date.now(); } };
    xhr.onload = () => {
      item.xhr = null;
      let body; try { body = JSON.parse(xhr.responseText); } catch { reject(new Error('Invalid receiver response. Retry to resume.')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(Object.assign(new Error(body.error || 'Transfer failed.'), { status:xhr.status }));
    };
    xhr.onerror = xhr.ontimeout = () => { item.xhr = null; reject(new Error('Connection interrupted. Retry to resume.')); };
    xhr.onabort = () => { item.xhr = null; reject(new Error('Transfer cancelled.')); };
    xhr.send(item.file.slice(start,end));
  });
}
async function upload(item) {
  item.status = 'sending'; item.error = ''; renderQueue();
  try {
    let chunkSize = 4 * 1024 * 1024;
    if (item.id) {
      try {
        const current = await api('/api/uploads/' + item.id);
        if (current.completed) { item.name = current.name; item.status = 'completed'; item.size = item.file.size; item.file = null; renderQueue(); return; }
        item.offset = current.offset;
      } catch (err) { if (err.status === 404) { item.id = null; item.offset = 0; } else throw err; }
    }
    if (!item.id) {
      const created = await api('/api/uploads', { method:'POST', body:JSON.stringify({ name:item.file.name, size:item.file.size, type:item.file.type, clientId:item.clientId,recipientId:item.recipientId || 'computer',destinationId:item.destinationId || 'default' }) });
      item.id = created.id; item.offset = created.offset; chunkSize = created.chunkSize;
    }
    if (item.cancelled) { await api('/api/uploads/' + item.id, { method:'DELETE' }); return; }
    while (item.offset < item.file.size && !item.cancelled) {
      let attempts = 0;
      for (;;) {
        try { const result = await sendChunk(item, item.offset, Math.min(item.offset + chunkSize, item.file.size)); item.offset = result.offset; item.displayOffset = item.offset; break; }
        catch (err) {
          if (item.cancelled || [401,403,404,410,423,507].includes(err.status) || ++attempts > 3) throw err;
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
          if (item.cancelled) throw err;
          const current = await api('/api/uploads/' + item.id); item.offset = current.offset;
          if (item.offset === item.file.size) break;
        }
      }
      renderQueue();
    }
    if (item.cancelled) return;
    item.status = 'finishing'; renderQueue();
    const result = await api('/api/uploads/' + item.id + '/complete', { method:'POST' });
    item.name = result.name; item.status = 'completed'; item.displayOffset = item.file.size; item.size = item.file.size; item.file = null;
    await health();
  } catch (err) {
    if (!item.cancelled) { item.status = 'failed'; item.error = err.message; }
    if (err.status === 401) await health();
  } finally { renderQueue(); }
}
async function pump() {
  if (sending || !token) return;
  sending = true;
  void window.LaneWebApp.setTransferring(true);
  try { let next; while ((next = queue.find(item => item.status === 'queued'))) await upload(next); }
  finally { sending = false;void window.LaneWebApp.setTransferring(false); }
}
$('#queue').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  const item = queue.find(q => q.localId === (button.dataset.retry || button.dataset.cancel)); if (!item) return;
  if (item.status === 'selected') { queue=queue.filter(q=>q !== item);renderQueue();return; }
  if (button.dataset.retry) {
    if (!item.file) return;
    item.cancelled = false; item.status = 'queued'; item.error = ''; renderQueue(); pump();
  } else {
    item.cancelled = true; item.status = 'cancelled'; item.xhr?.abort(); renderQueue();
    if (item.id) try { await api('/api/uploads/' + item.id, { method:'DELETE' }); } catch {}
  }
});
$('#clear-completed').addEventListener('click', () => { queue = queue.filter(item => !['completed','cancelled'].includes(item.status)); renderQueue(); });
$('#forget-button').addEventListener('click', () => {
  if (sending) { $('#connection-warning').hidden = false; $('#connection-warning').textContent = 'Finish or cancel active transfers before forgetting this computer.'; return; }
  if (confirm('Forget this computer in this browser? You will need to pair again.')) { forget(); queue = []; renderQueue(); }
});
window.addEventListener('beforeunload', event => { if (queue.some(q => ['selected','queued','sending','finishing'].includes(q.status))) { event.preventDefault(); event.returnValue = ''; } });
setInterval(health, 3000);
document.addEventListener('visibilitychange',()=>{if (!document.hidden) health();});
init();
