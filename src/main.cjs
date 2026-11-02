const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification, clipboard, powerSaveBlocker } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const QRCode = require('qrcode');
const { Receiver } = require('./server.cjs');
const messageFormat = require('./shared/message-format.js');
const { ClipboardItem, nativeTheme, safeStorage } = require('electron');
const { Discovery } = require('./discovery.cjs');
const { launchRequest } = require('./windows-actions.cjs');

let window, tray, receiver, quitting = false, awake, startupError = null;
let rendererReady=false, pendingLaunch=launchRequest(process.argv);
let activeConversation='';
const windowAttended=()=>Boolean(window && !window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused());
const fileSelections = new Map();
const pagePath = path.join(__dirname, 'desktop', 'index.html');
const testMode = process.env.LANE_TEST === '1';
if (testMode && process.env.LANE_DATA_DIR) app.setPath('userData', process.env.LANE_DATA_DIR);
app.setName('Lane');
app.setAppUserModelId('local.lane.transfer');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event,argv) => { pendingLaunch=launchRequest(argv);window?.show();window?.focus();void flushLaunch(); });
  app.whenReady().then(async () => {
    const tls=!testMode || process.env.LANE_TEST_HTTPS==='1';
    const protect=!testMode ? {seal:value=>{if(!safeStorage.isEncryptionAvailable())throw new Error('Windows key protection is unavailable.');return safeStorage.encryptString(value).toString('base64');},open:value=>safeStorage.decryptString(Buffer.from(value,'base64'))} : undefined;
    receiver = new Receiver({ dataDir: app.getPath('userData'), defaultFolder: process.env.LANE_TEST_FOLDER || path.join(app.getPath('downloads'), 'Lane'), port: testMode ? Number(process.env.LANE_PORT || 0) : 47831,tls,tlsPort:testMode ? 0 : 47832,protect });
    try { await receiver.start(); } catch (err) { startupError = err.code === 'EADDRINUSE' ? 'A Lane port (47831 or 47832) is already in use. Close the other receiver and restart Lane.' : 'Lane could not start its local receiver: '+err.message; }
    registerIPC();
    nativeTheme.themeSource = receiver.state.settings.theme || 'dark';
    createWindow();
    updateTheme();
    nativeTheme.on('updated',updateTheme);
    createTray();
    if (!testMode) {
      receiver.discovery=new Discovery(receiver);receiver.discovery.start();
      if (app.isPackaged) {
        const program=process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
        app.setUserTasks(['messages','send','pair'].map(action=>({program,arguments:'--lane-action='+action,iconPath:program,iconIndex:0,title:{messages:'Open messages',send:'Send files',pair:'Pair a device'}[action],description:'Open Lane'})));
        if (receiver.state.settings.sendToMenu) setSendTo(true);
      }
    }
    receiver.on('change', () => {
      window?.webContents.send('lane:changed');
      const active = receiver.jobs.size > 0 || receiver.outbox.streams.size > 0;
      if (active && awake === undefined) awake = powerSaveBlocker.start('prevent-app-suspension');
      if (!active && awake !== undefined) { powerSaveBlocker.stop(awake); awake = undefined; }
      updateTray();
      updateTaskbar();
    });
    receiver.on('received', record => {
      if (!testMode && receiver.state.settings.notifications && Notification.isSupported()) {
        new Notification({ title: 'File received', body: `${record.name} · from ${record.deviceName}`, silent: true }).show();
      }
    });
    receiver.on('connected', device => {
      if (!testMode && receiver.state.settings.notifications && Notification.isSupported()) {
        new Notification({ title:`Connected — ${device.name}`, body:'You can now send and receive files with this device.', silent:true }).show();
      }
    });
    receiver.on('message', device => {
      const silent=receiver.state.mutedConversations.includes(device.deviceId) || windowAttended() && activeConversation===device.deviceId;
      window?.webContents.send('lane:message', {...device,silent});
      if (!silent && !testMode && receiver.state.settings.notifications && Notification.isSupported()) {
        const notification = new Notification({ title:`Message from ${device.name}`, body:'Open Messages in Lane to read and reply.', silent:true });
        notification.on('click', () => { window?.show(); window?.focus(); window?.webContents.send('lane:open-messages', device.deviceId); });
        notification.show();
      }
    });
  }).catch(err => { dialog.showErrorBox('Lane could not start', err.message); app.exit(1); });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1250, height: 860, minWidth: 980, minHeight: 680,
    show: !testMode && !process.argv.includes('--background'),
    title: 'Lane', backgroundColor: '#111c21', icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#111c21', symbolColor: '#dce9e2', height: 38 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy:'no-user-gesture-required', backgroundThrottling:false }
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.on('will-download', event => event.preventDefault());
  window.loadFile(pagePath);
  for(const event of ['focus','blur','show','hide','minimize','restore']) window.on(event,()=>window.webContents.send('lane:attention',windowAttended()));
  window.on('close', event => {
    if (!quitting && !testMode && receiver.state.settings.minimizeToTray && tray) { event.preventDefault(); window.hide(); }
  });
}
function updateTheme() {
  if (!window || window.isDestroyed()) return;
  const dark = nativeTheme.shouldUseDarkColors;
  window.setBackgroundColor(dark ? '#111c21' : '#f5f6f8');
  window.setTitleBarOverlay({color:dark ? '#111c21' : '#f5f6f8',symbolColor:dark ? '#dce9e2' : '#374151',height:38});
}
function createTray() {
  if (testMode) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 32, height: 32 }));
  tray.setToolTip('Lane · Local file transfer');
  tray.on('double-click', () => { window.show(); window.focus(); });
  updateTray();
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Lane', click: () => { window.show(); window.focus(); } },
    ...['messages','send','pair'].map(action=>({label:{messages:'Messages',send:'Send files…',pair:'Pair a device…'}[action],click:()=>{pendingLaunch={action};void flushLaunch();}})),
    { label: 'Receive files', type: 'checkbox', checked: receiver.state.settings.accepting, click: item => receiver.updateSettings({ accepting: item.checked }) },
    { type: 'separator' },
    { label: 'Quit Lane', click: () => { quitting = true; app.quit(); } }
  ]));
}
async function selectFiles(paths) {
  if (!paths.length || paths.length>100) throw new Error('Choose up to 100 files.');
  const files=[];
  for (const filename of paths) {
    if (!path.isAbsolute(filename)) throw new Error('Choose local files.');
    const stat=await require('node:fs/promises').stat(filename);
    if (!stat.isFile()) throw new Error('Choose individual files. Folders are not supported yet.');
    files.push({name:path.basename(filename),size:stat.size});
  }
  const selectionId=require('node:crypto').randomUUID();
  if(fileSelections.size>=10)fileSelections.delete(fileSelections.keys().next().value);
  fileSelections.set(selectionId,paths);return {selectionId,files};
}
async function flushLaunch() {
  if (!rendererReady || !pendingLaunch || !window) return;
  const request=pendingLaunch;pendingLaunch=null;window.show();window.focus();
  try { window.webContents.send('lane:launch-action',{action:request.action,selection:request.files ? await selectFiles(request.files) : null}); }
  catch (err) { window.webContents.send('lane:launch-action',{error:err.message}); }
}
function setSendTo(enabled) {
  if(testMode)return;
  if(!app.isPackaged)throw new Error('Use the packaged Lane app for Windows Send to integration.');
  const filename=path.join(app.getPath('appData'),'Microsoft','Windows','SendTo','Lane.lnk'),fs=require('node:fs');
  if(enabled) {
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    const target=process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
    if(!shell.writeShortcutLink(filename,'create',{target,args:'--lane-send',description:'Choose a device and send with Lane',appUserModelId:'local.lane.transfer'}))throw new Error('Windows could not create the Send to shortcut.');
  } else if(fs.existsSync(filename) && shell.readShortcutLink(filename).appUserModelId==='local.lane.transfer') fs.unlinkSync(filename);
}
function updateTaskbar() {
  if(!window || window.isDestroyed())return;
  const unread=receiver.messages.summary().reduce((n,c)=>n+c.unread,0);
  window.setTitle(unread ? `Lane · ${unread} unread` : 'Lane');
  if(unread) {
    const pixels=Buffer.alloc(16*16*4);
    for(let y=0;y<16;y++)for(let x=0;x<16;x++)if((x-7.5)**2+(y-7.5)**2<49){const i=(y*16+x)*4;pixels[i]=90;pixels[i+1]=170;pixels[i+2]=225;pixels[i+3]=255;}
    window.setOverlayIcon(nativeImage.createFromBitmap(pixels,{width:16,height:16}),`${unread} unread messages`);
  } else window.setOverlayIcon(null,'');
  const jobs=[...receiver.jobs.values()],size=jobs.reduce((n,j)=>n+j.record.size,0),received=jobs.reduce((n,j)=>n+j.offset+j.inflight,0);
  window.setProgressBar(size ? Math.min(1,received/size) : receiver.outbox.streams.size ? 2 : -1);
}
function registerIPC() {
  const handle = (name, fn) => ipcMain.handle('lane:' + name, (event, ...args) => {
    if (event.senderFrame?.url !== pathToFileURL(pagePath).href) throw new Error('Untrusted page.');
    return fn(...args);
  });
  handle('snapshot', () => ({ ...receiver.snapshot(), startupError, portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE) }));
  handle('renderer-ready',()=>{rendererReady=true;void flushLaunch();});
  handle('conversation',id=>{activeConversation=typeof id==='string' && receiver.state.devices.some(d=>d.id===id) ? id : '';return windowAttended();});
  handle('export-certificate',async()=>{
    if(!receiver.tls) throw new Error('HTTPS is unavailable.');
    const result=await dialog.showSaveDialog(window,{title:'Save Lane root certificate',defaultPath:path.join(app.getPath('downloads'),'Lane-Local-CA.cer'),filters:[{name:'Certificate',extensions:['cer']}]});
    if(!result.canceled && result.filePath) await require('node:fs/promises').writeFile(result.filePath,receiver.tls.certificate);
    return !result.canceled;
  });
  handle('save-recovery',async data=>{
    if(typeof data!=='string' || data.length>12*1024*1024 || JSON.parse(data).type!=='lane-recovery')throw new Error('Invalid recovery file.');
    const result=await dialog.showSaveDialog(window,{title:'Save encrypted Lane identity',defaultPath:path.join(app.getPath('downloads'),'Lane-computer.lane-backup'),filters:[{name:'Lane recovery',extensions:['lane-backup']}]});
    if(!result.canceled && result.filePath)await require('node:fs/promises').writeFile(result.filePath,data,'utf8');return !result.canceled;
  });
  handle('setup-qr',async address=>{const selected=receiver.snapshot().addresses.find(a=>a.address===address);if(!selected)throw new Error('Select a local address.');return {url:selected.setupUrl,image:await QRCode.toDataURL(selected.setupUrl,{width:240,margin:2})};});
  handle('open-nearby',id=>{const peer=receiver.discovery?.snapshot().computers.find(p=>p.id===id);if(!peer)throw new Error('This computer is no longer nearby.');return shell.openExternal(peer.url);});
  handle('pair', () => receiver.openPairing());
  handle('close-pairing', () => receiver.closePairing());
  handle('qr', async address => {
    const selected = receiver.snapshot().addresses.find(a => a.address === address);
    if (!selected || !receiver.pairing || receiver.pairing.expires < Date.now()) return null;
    const key=receiver.state.identityPublicKey;
    const url = `${selected.url}/#code=${receiver.pairing.code}${key ? '&key='+key.x+'.'+key.y : ''}`;
    return { url, image: await QRCode.toDataURL(url, { width: 240, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#17242c', light: '#ffffff' } }) };
  });
  handle('choose-files', async () => {
    const result = await dialog.showOpenDialog(window,{title:'Choose files to send',properties:['openFile','multiSelections']});
    if (result.canceled || !result.filePaths.length) return null;
    const files = [];
    for (const filename of result.filePaths) {
      const stats = await require('node:fs/promises').stat(filename);
      if (!stats.isFile()) throw new Error('Choose individual files.');
      files.push({name:path.basename(filename),size:stats.size});
    }
    const selectionId = require('node:crypto').randomUUID();
    if (fileSelections.size >= 10) fileSelections.delete(fileSelections.keys().next().value);
    fileSelections.set(selectionId,result.filePaths);
    return {selectionId,files};
  });
  handle('send-files', async (deviceId,selectionId) => {
    const paths = fileSelections.get(selectionId);
    if (!paths) throw new Error('Choose the files again.');
    const result = await receiver.outbox.enqueue(String(deviceId),paths);
    fileSelections.delete(selectionId);
    return result;
  });
  handle('revoke', id => receiver.revoke(String(id)));
  handle('messages', (deviceId, revision, limit) => receiver.messages.list(deviceId, revision, limit));
  handle('send-message', (deviceId, body) => receiver.messages.send(deviceId, 'outgoing', body));
  handle('ack-messages', (deviceId, body) => receiver.messages.acknowledge(deviceId, 'incoming', body));
  handle('clear-messages', deviceId => receiver.messages.clear(deviceId));
  handle('react-message',(deviceId,id,emoji) => { receiver.messages.get(deviceId,id); return receiver.messages.react('computer',id,emoji); });
  handle('copy-message', (deviceId, id, mode) => {
    const m = receiver.messages.get(deviceId, id);
    if (mode === 'formatted') return clipboard.write([new ClipboardItem({ 'text/plain':messageFormat.plain(m.text,m.format), 'text/html':messageFormat.html(m.text,m.format) })]);
    return clipboard.writeText(mode === 'source' ? m.text : messageFormat.plain(m.text,m.format));
  });
  handle('copy-content', body => {
    if (!body || typeof body.text !== 'string' || body.text.length > 100_000 || !['plain','markdown'].includes(body.format) || !['plain','source','formatted'].includes(body.mode)) throw new Error('Invalid message.');
    const text = body.mode === 'source' ? body.text : messageFormat.plain(body.text,body.format);
    if (body.mode === 'formatted') return clipboard.write([new ClipboardItem({ 'text/plain':text, 'text/html':messageFormat.html(body.text,body.format) })]);
    return clipboard.writeText(text);
  });
  handle('save-content', async body => {
    if (!body || typeof body.text !== 'string' || body.text.length > 100_000 || !['plain','markdown'].includes(body.format)) throw new Error('Invalid message.');
    const suffix = body.format === 'markdown' ? 'md' : 'txt';
    const result = await dialog.showSaveDialog(window, { title:'Save note', defaultPath:path.join(app.getPath('downloads'), `Lane-note-${new Date().toISOString().slice(0,10)}.${suffix}`), filters:[{name:'Text notes',extensions:['txt','md']}] });
    if (!result.canceled && result.filePath) { await require('node:fs/promises').writeFile(result.filePath, body.text, 'utf8'); return true; }
    return false;
  });
  handle('save-message', async (deviceId, id) => {
    const m = receiver.messages.get(deviceId, id);
    const result = await dialog.showSaveDialog(window, { title:'Save note', defaultPath:path.join(app.getPath('downloads'), `Lane-note-${new Date(m.created).toISOString().slice(0,10)}.${m.format === 'markdown' ? 'md' : 'txt'}`), filters:[{name:'Text notes',extensions:['txt','md']}] });
    if (!result.canceled && result.filePath) { await require('node:fs/promises').writeFile(result.filePath, m.text, 'utf8'); return true; }
    return false;
  });
  handle('cancel', id => receiver.cancel(String(id)));
  handle('clear-history', () => receiver.clearHistory());
  handle('choose-folder', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose receiving folder', defaultPath: receiver.state.settings.folder, properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled && result.filePaths[0]) await receiver.updateSettings({ folder: result.filePaths[0] });
    return receiver.state.settings.folder;
  });
  handle('add-destination', async name => {
    const result=await dialog.showOpenDialog(window,{title:'Choose project destination',properties:['openDirectory','createDirectory']});
    if(!result.canceled && result.filePaths[0])return receiver.addDestination(name,result.filePaths[0]);
    return null;
  });
  handle('remove-destination',id=>receiver.removeDestination(String(id)));
  handle('mute-conversation',(id,muted)=>receiver.muteConversation(id,muted));
  handle('save-diagnostics',async report=>{
    const clean=require('./shared/connection-check.js').sanitize(report || {});
    const result=await dialog.showSaveDialog(window,{title:'Save diagnostic report',defaultPath:path.join(app.getPath('downloads'),'Lane-diagnostics.json'),filters:[{name:'Diagnostic report',extensions:['json']}]});
    if(!result.canceled && result.filePath)await require('node:fs/promises').writeFile(result.filePath,JSON.stringify(clean,null,2),'utf8');
    return !result.canceled;
  });
  handle('settings', async patch => {
    const allowed = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => ['computerName', 'accepting', 'startAtLogin', 'minimizeToTray', 'notifications','messageSound','theme','nearbyDiscovery','sendToMenu','httpsOnly'].includes(key)));
    if ('sendToMenu' in allowed) { if(typeof allowed.sendToMenu!=='boolean')throw new Error('Invalid setting.');setSendTo(allowed.sendToMenu); }
    if ('startAtLogin' in allowed && !testMode) app.setLoginItemSettings({ openAtLogin: Boolean(allowed.startAtLogin), path: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe'), args: ['--background'] });
    await receiver.updateSettings(allowed);
    if (allowed.theme) { nativeTheme.themeSource = receiver.state.settings.theme || 'dark'; updateTheme(); }
  });
  handle('set-identity-public-key', key => receiver.updateIdentityPublicKey(key));
  handle('open-folder', async () => {
    await require('node:fs/promises').mkdir(receiver.state.settings.folder, { recursive: true });
    const message = await shell.openPath(receiver.state.settings.folder);
    if (message) throw new Error(message);
  });
  handle('reveal', async id => {
    const record = receiver.state.history.find(h => h.id === id && (h.status === 'completed' || h.direction === 'outgoing'));
    if (record?.path) {
      await require('node:fs/promises').access(record.path);
      shell.showItemInFolder(record.path);
    }
  });
  handle('copy-address', address => {
    const selected = receiver.snapshot().addresses.find(a => a.address === address);
    if (selected) return clipboard.writeText(selected.url);
  });
}
app.on('window-all-closed', () => { if (!tray || testMode) app.quit(); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { receiver?.discovery?.stop();receiver?.save(); tray?.destroy(); });
