const http = require('node:http');
const https = require('node:https');
const { LocalTLS } = require('./local-tls.cjs');
const { deviceProfile } = require('./device-profile.cjs');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Outbox } = require('./outbox.cjs');
const { Messages } = require('./messages.cjs');

const CHUNK_SIZE = 4 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const error = (status, message) => Object.assign(new Error(message), { status });
const { validPublicKey, samePublicKey } = require('./public-key.cjs');
function isPrivate(address = '') {
  address = address.replace(/^::ffff:/, '');
  return address === '::1' || /^127\./.test(address) || /^10\./.test(address) || /^192\.168\./.test(address) || /^169\.254\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}
function addresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => (entries || [])
    .filter(e => e.family === 'IPv4' && !e.internal && isPrivate(e.address))
    .map(e => ({ name, address: e.address })))
    .sort((a, b) => Number(/virtual|vmware|vethernet|wsl|docker|tailscale/i.test(a.name)) - Number(/virtual|vmware|vethernet|wsl|docker|tailscale/i.test(b.name)));
}
function safeName(value) {
  let name = String(value || '').split(/[\\/]/).pop().normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!name || /^\.+$/.test(name)) name = 'Untitled file';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  if (name.length > 180) {
    const ext = path.extname(name).slice(0, 25);
    name = name.slice(0, 180 - ext.length) + ext;
  }
  return name;
}
async function jsonBody(req, limit = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw error(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw error(400, 'Invalid request.'); }
}
function respond(res, status, data) {
  if (!res.destroyed && !res.writableEnded) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
}

class Receiver extends EventEmitter {
  constructor({ dataDir, defaultFolder, port = 47831, host = '0.0.0.0', tlsPort = 47832, tls = false, protect }) {
    super();
    this.dataDir = dataDir;
    this.port = port;
    this.host = host;
    this.tlsEnabled=tls;this.tlsPort=tlsPort;this.protect=protect;
    this.jobs = new Map();
    this.pending = new Map();
    this.rate = new Map();
    this.relayTasks = new Map();
    this.pairing = null;
    this.connectionNotice = null;
    this.lastEmit = 0;
    this.saveTimer = null;
    fs.mkdirSync(dataDir, { recursive: true });
    const configPath = path.join(dataDir, 'state.json');
    this.state = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {
      receiverId: crypto.randomUUID(),
      settings: { computerName: os.hostname(), folder: defaultFolder, accepting: true, startAtLogin: false, minimizeToTray: true, notifications: true, messageSound: false, theme: 'dark', httpsOnly:tls },
      devices: [], history: []
    };
    this.state.settings.theme ||= 'dark';
    this.state.settings.messageSound ??= false;
    this.state.settings.notifications ??= true;
    this.state.settings.nearbyDiscovery ??= true;
    this.state.settings.httpsOnly ??= false;
    this.state.destinations ||= [];
    this.state.mutedConversations ||= [];
    this.state.identityPublicKey ||= null;
    this.state.history = (this.state.history || []).filter((h,i) => i < 300 || this.state.outbox?.some(o => o.id === h.id));
    for (const item of this.state.history) {
      item.direction ||= 'incoming';
      if(['receiving','waiting'].includes(item.status) && item.resume && this.restoreUpload(item)) continue;
      if (['receiving', 'waiting'].includes(item.status)) {
        item.status = 'interrupted'; item.message = 'The receiver restarted. Send this file again.';
      }
    }
    // Delete only explicitly recorded, app-owned partial files from the last session.
    for (const item of this.state.history) {
      if(this.jobs.has(item.id)) continue;
      if (item.temp && path.basename(path.dirname(item.temp)) === '.lane-incoming' && /^[0-9a-f-]{36}\.part$/.test(path.basename(item.temp))) {
        try { fs.unlinkSync(item.temp); } catch {}
      }
      delete item.temp;
      delete item.resume;
    }
    this.outbox = new Outbox(this);
    this.messages = new Messages(this);
    this.save();
  }
  restoreUpload(record) {
    const meta=record.resume;
    try {
      if(!this.state.devices.some(d=>d.id===record.deviceId) || record.recipientId!=='computer' && !this.state.devices.some(d=>d.id===record.recipientId))return false;
      if(this.jobs.size>=16 || !/^[0-9a-f-]{36}$/.test(record.id) || !path.isAbsolute(meta.folder) || record.temp!==path.join(meta.folder,'.lane-incoming',record.id+'.part') || typeof meta.clientId!=='string')return false;
      if(!Number.isSafeInteger(record.received) || record.received<0 || record.received>record.size || !Number.isFinite(meta.touched) || Date.now()-meta.touched>24*60*60_000)return false;
      const stat=fs.lstatSync(record.temp);if(!stat.isFile() || stat.isSymbolicLink() || fs.lstatSync(path.dirname(record.temp)).isSymbolicLink() || stat.size<record.received)return false;
      fs.truncateSync(record.temp,record.received);
      record.status='waiting';record.message='Ready to resume. Keep the original sender page open and tap Retry.';
      this.jobs.set(record.id,{record,folder:meta.folder,temp:record.temp,offset:record.received,inflight:0,busy:false,touched:meta.touched,clientId:meta.clientId,cancelled:false});return true;
    } catch {return false;}
  }
  save() {
    const filename = path.join(this.dataDir, 'state.json');
    fs.writeFileSync(filename + '.tmp', JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(filename + '.tmp', filename);
  }
  changed(immediate = true) {
    if (immediate || Date.now() - this.lastEmit > 150) {
      this.lastEmit = Date.now(); this.emit('change');
    }
  }
  snapshot() {
    const now = Date.now();
    return {
      version: '0.10.0', receiverId: this.state.receiverId, computerPublicKey: this.state.identityPublicKey,
      settings: { ...this.state.settings },
      destinations: this.state.destinations.map(d=>({...d})),
      mutedConversations: [...this.state.mutedConversations],
      nearby:this.discovery?.snapshot() || {status:'off',computers:[]},
      addresses: addresses().map(a => ({ ...a, url: this.state.settings.httpsOnly ? `https://${a.address}:${this.tlsPort}` : `http://${a.address}:${this.port}`, secureUrl:this.tlsServer?.listening ? `https://${a.address}:${this.tlsPort}` : null, setupUrl:`http://${a.address}:${this.port}/setup` })),
      transport:{available:Boolean(this.tlsServer?.listening),httpsOnly:this.state.settings.httpsOnly,port:this.tlsPort,...this.tls?.snapshot()},
      port: this.port, running: Boolean(this.server?.listening),
      devices: this.state.devices.map(({ tokenHash, ...device }) => ({ ...device, online:now - device.lastSeen < 20_000 })),
      connectionNotice:this.connectionNotice,
      outgoing:this.outbox.list(),
      conversations:this.messages.summary(),
      pairing: this.pairing?.expires > now ? { ...this.pairing } : null,
      history: this.state.history.map(({ temp, ...item }) => ({ ...item })),
      active: [...this.jobs.values()].map(j => ({ ...j.record, temp: undefined, received: j.offset + j.inflight })).concat(this.state.history.filter(h => h.direction === 'outgoing' && h.status === 'sending'))
    };
  }
  destinations() {
    return [{id:'default',name:'Receiving folder'}, ...this.state.destinations.map(({id,name})=>({id,name}))];
  }
  async addDestination(name, folder) {
    if (typeof name!=='string' || !name.trim() || name.trim().length>60) throw error(400,'Name the destination using 1–60 characters.');
    if (this.state.destinations.length>=20) throw error(400,'You can save up to 20 destinations.');
    if (this.state.destinations.some(d=>d.name.toLowerCase()===name.trim().toLowerCase())) throw error(409,'A destination already has that name.');
    if (typeof folder!=='string' || !path.isAbsolute(folder)) throw error(400,'Choose an absolute folder path.');
    await fsp.mkdir(folder,{recursive:true}); await fsp.access(folder,fs.constants.W_OK);
    const destination={id:crypto.randomUUID(),name:name.trim(),folder:path.resolve(folder)};
    this.state.destinations.push(destination);this.save();this.changed();return destination;
  }
  removeDestination(id) {
    this.state.destinations=this.state.destinations.filter(d=>d.id!==id);this.save();this.changed();
  }
  muteConversation(id,muted) {
    if(!this.state.devices.some(d=>d.id===id) || typeof muted!=='boolean')throw error(400,'Choose a paired conversation.');
    this.state.mutedConversations=this.state.mutedConversations.filter(value=>value!==id);
    if(muted)this.state.mutedConversations.push(id);this.save();this.changed();
  }
  openPairing() {
    this.pairing = { code: String(crypto.randomInt(100000, 1000000)), expires: Date.now() + 5 * 60_000 };
    this.changed(); return this.pairing;
  }
  closePairing() { this.pairing = null; this.changed(); }
  connected(device) {
    this.connectionNotice = { id:crypto.randomUUID(), deviceId:device.id, name:device.name, at:Date.now() };
    this.emit('connected', this.connectionNotice);
    this.changed();
  }
  async revoke(id) {
    this.state.mutedConversations=this.state.mutedConversations.filter(value=>value!==id);
    this.state.devices = this.state.devices.filter(d => d.id !== id);
    for (const job of this.jobs.values()) if (job.record.deviceId === id || job.record.recipientId === id) await this.cancel(job.record.id, 'Device access removed.');
    for (const offer of [...this.state.outbox]) if (offer.deviceId === id || offer.senderId === id) this.outbox.cancel(offer.id, 'Device access removed.');
    this.messages.removeDevice(id);
    this.save(); this.changed();
  }
  async updateSettings(patch) {
    const next = { ...this.state.settings };
    if (['light','dark','system'].includes(patch.theme)) next.theme = patch.theme;
    if (typeof patch.computerName === 'string') next.computerName = patch.computerName.trim().slice(0, 60) || os.hostname();
    for (const key of ['accepting', 'startAtLogin', 'minimizeToTray', 'notifications', 'messageSound', 'nearbyDiscovery', 'sendToMenu','httpsOnly']) {
      if (typeof patch[key] === 'boolean') next[key] = patch[key];
    }
    if (next.httpsOnly && !this.tlsServer?.listening) throw error(409,'HTTPS is unavailable. Restart Lane to retry certificate setup.');
    if (patch.folder) {
      if (!path.isAbsolute(patch.folder)) throw error(400, 'Choose an absolute folder path.');
      await fsp.mkdir(patch.folder, { recursive: true });
      await fsp.access(patch.folder, fs.constants.W_OK);
      next.folder = path.resolve(patch.folder);
    }
    const discoveryChanged=next.nearbyDiscovery!==this.state.settings.nearbyDiscovery || next.computerName!==this.state.settings.computerName || next.httpsOnly!==this.state.settings.httpsOnly;
    const closePlaintext=next.httpsOnly && !this.state.settings.httpsOnly;
    this.state.settings = next; this.save(); if(discoveryChanged)this.discovery?.start();this.changed();
    if(closePlaintext)this.server?.closeAllConnections();
  }
  updateIdentityPublicKey(publicKey) {
    if (!validPublicKey(publicKey)) throw error(400, 'Invalid encryption key.');
    if (this.state.identityPublicKey && !samePublicKey(this.state.identityPublicKey,publicKey)) throw error(409,'The computer encryption key changed. Restore the original Lane browser profile to read existing encrypted messages.');
    this.state.identityPublicKey = publicKey;
    this.save(); this.changed();
    return { publicKey };
  }
  clearHistory() {
    this.state.history = this.state.history.filter(h => this.jobs.has(h.id) || this.state.outbox.some(o => o.id === h.id));
    this.save(); this.changed();
  }
  authenticate(req, download = false) {
    const cookie = download ? String(req.headers.cookie || '').match(/(?:^|;\s*)lane_download=([A-Za-z0-9_-]+)/)?.[1] : '';
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '') || cookie;
    if (!token || token.length > 100) throw error(401, 'Pair this device with Lane first.');
    const device = this.state.devices.find(d => d.tokenHash === hash(token));
    if (!device) throw error(401, 'This device is no longer paired.');
    device.lastSeen = Date.now();
    return device;
  }
  setDownloadCookie(req, res) {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    res.setHeader('Set-Cookie', `lane_download=${token}; HttpOnly; SameSite=Strict; Path=/download/; Max-Age=2592000${req.socket.encrypted ? '; Secure' : ''}`);
  }
  async start() {
    const handler=(req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      this.handle(req, res).catch(err => {
        if (res.headersSent) { res.destroy(); return; }
        respond(res, err.status || 500, { error: err.status ? err.message : 'Could not access the file. Check the folder and available disk space.' });
      });
    };
    if(this.tlsEnabled) {
      this.tls=await new LocalTLS(this.dataDir,this.state.receiverId,this.protect).prepare(addresses().map(a=>a.address));
      this.tlsServer=https.createServer(this.tls.options(),handler);
      this.tlsServer.requestTimeout=120_000;this.tlsServer.headersTimeout=15_000;
      await new Promise((resolve,reject)=>{this.tlsServer.once('error',reject);this.tlsServer.listen(this.tlsPort,this.host,resolve);});
      this.tlsPort=this.tlsServer.address().port;
    }
    this.server = http.createServer(handler);
    this.server.requestTimeout = 120_000;
    this.server.headersTimeout = 15_000;
    try { await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, resolve);
    }); } catch(err) { this.tlsServer?.closeAllConnections();this.tlsServer?.close();throw err; }
    this.port = this.server.address().port;
    this.cleanupTimer = setInterval(() => this.sweep().catch(() => {}), 30_000).unref();
    this.changed(); return this;
  }
  async stop() {
    this.discovery?.stop();
    clearInterval(this.cleanupTimer);
    if (this.server?.listening) {
      this.server.closeAllConnections();
      await new Promise(resolve => this.server.close(resolve));
    }
    if(this.tlsServer?.listening) {this.tlsServer.closeAllConnections();await new Promise(resolve=>this.tlsServer.close(resolve));}
    while([...this.jobs.values()].some(job=>job.busy)) await new Promise(resolve=>setTimeout(resolve,20));
    for(const job of this.jobs.values()){job.record.status='waiting';job.record.message='Receiver closed. Reopen Lane and retry from the original sender page.';}
    this.save();
  }
  async sweep() {
    if(this.tls && !this.tlsRefreshing) {
      this.tlsRefreshing=true;
      try { if(await this.tls.refresh(addresses().map(a=>a.address))) this.tlsServer.setSecureContext(this.tls.options()); }
      finally { this.tlsRefreshing=false; }
    }
    const now = Date.now();
    this.outbox.sweep();
    for (const [id, p] of this.pending) if (p.expires < now) this.pending.delete(id);
    for (const [ip, r] of this.rate) if (r.until < now) this.rate.delete(ip);
    for (const job of this.jobs.values()) if (!job.busy && now - job.touched > 24 * 60 * 60_000) await this.cancel(job.record.id, 'Transfer expired after 24 hours. Send this file again.');
    this.changed();
  }
  async cancel(id, message = 'Transfer cancelled.') {
    if (this.state.outbox.some(o => o.id === id)) { this.outbox.cancel(id,message); return; }
    const job = this.jobs.get(id);
    if (!job) return;
    job.cancelled = true;
    job.record.status = 'cancelled'; job.record.message = message;
    if (job.busy) { this.changed(); return; }
    await fsp.unlink(job.temp).catch(() => {});
    delete job.record.temp;
    delete job.record.resume;
    this.jobs.delete(id); this.save(); this.changed();
  }
  async createUpload(device, meta) {
    if (!this.state.settings.accepting) throw error(423, 'Receiving is paused on the computer.');
    if (typeof meta.name !== 'string' || !Number.isSafeInteger(meta.size) || meta.size < 0 || typeof meta.clientId !== 'string' || meta.clientId.length > 100) throw error(400, 'Invalid file details.');
    const recipientId = meta.recipientId || 'computer';
    const recipient = this.messages.participant(recipientId);
    if (recipientId === device.id) throw error(400, 'Choose another device to receive the file.');
    const existing = [...this.jobs.values()].find(j => j.record.deviceId === device.id && j.clientId === meta.clientId);
    if (existing) {
      if ((existing.record.destinationId || 'default') !== (meta.destinationId || 'default')) throw error(409,'This transfer already has a different destination.');
      if ((existing.record.recipientId || 'computer') !== recipientId) throw error(409, 'This transfer already has a different recipient.');
      if(existing.record.size!==meta.size || existing.record.name!==safeName(meta.name))throw error(409,'This transfer belongs to a different file.');
      return { id: existing.record.id, offset: existing.offset, chunkSize: CHUNK_SIZE };
    }
    if (this.jobs.size >= 16 || [...this.jobs.values()].filter(j => j.record.deviceId === device.id).length >= 4) throw error(429, 'Too many unfinished transfers. Cancel one or try again later.');
    const destinationId=meta.destinationId || 'default';
    const destination=destinationId==='default' ? {folder:this.state.settings.folder,name:'Receiving folder'} : this.state.destinations.find(d=>d.id===destinationId);
    if (!destination) throw error(404,'This destination was removed. Select a receiving folder and send again.');
    if (recipientId!=='computer' && destinationId!=='default') throw error(400,'Project destinations are for files sent to this computer.');
    const folder = destination.folder;
    await fsp.mkdir(folder, { recursive: true });
    const disk = await fsp.statfs(folder);
    // Conservatively reserve unfinished bytes across destinations, which may share a disk.
    const reserved = [...this.jobs.values()].reduce((n, j) => n + j.record.size - j.offset, 0);
    if (meta.size + reserved + 16 * 1024 * 1024 > disk.bavail * disk.bsize) throw error(507, 'There is not enough free space in the receiving folder.');
    const id = crypto.randomUUID();
    const tempDir = path.join(folder, '.lane-incoming');
    await fsp.mkdir(tempDir, { recursive: true });
    if ((await fsp.lstat(tempDir)).isSymbolicLink()) throw error(400, 'The temporary folder must not be a symbolic link.');
    const temp = path.join(tempDir, id + '.part');
    const file = await fsp.open(temp, 'wx'); await file.close();
    const record = { id, name: safeName(meta.name), size: meta.size, received: 0, type: String(meta.type || '').slice(0, 100), deviceId: device.id, deviceName: device.name, recipientId, recipientName:recipient.name, direction:'incoming', status: 'receiving', created: Date.now(), temp };
    record.destinationId=destinationId;record.destinationName=destination.name;
    record.resume={folder,clientId:meta.clientId,touched:Date.now()};
    this.jobs.set(id, { record, folder, temp, offset: 0, inflight: 0, busy: false, touched: Date.now(), clientId: meta.clientId, cancelled: false });
    this.state.history.unshift(record);
    // Keep all live transfers; trim only completed history.
    this.state.history = this.state.history.filter((h, i) => i < 300 || this.jobs.has(h.id) || this.state.outbox.some(o => o.id === h.id));
    this.save(); this.changed();
    return { id, offset: 0, chunkSize: CHUNK_SIZE };
  }
  async chunk(req, res, job) {
    if (job.busy) throw error(409, 'This transfer is already receiving a chunk.');
    if (job.cancelled) throw error(410, 'Transfer cancelled.');
    const offset = Number(req.headers['x-file-offset']);
    const length = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(offset) || offset !== job.offset) throw error(409, 'Transfer position changed. Retry to resume.');
    if (!Number.isSafeInteger(length) || length < 1 || length > CHUNK_SIZE || offset + length > job.record.size) throw error(400, 'Invalid chunk size.');
    job.busy = true; job.touched = Date.now();
    let file;
    try {
      file = await fsp.open(job.temp, 'r+');
      let received = 0;
      for await (const buffer of req) {
        if (job.cancelled) throw error(410, 'Transfer cancelled.');
        if (received + buffer.length > length) throw error(413, 'Chunk is too large.');
        let written = 0;
        while (written < buffer.length) {
          const result = await file.write(buffer, written, buffer.length - written, offset + received + written);
          if (!result.bytesWritten) throw error(500, 'Could not write the file.');
          written += result.bytesWritten;
        }
        received += buffer.length; job.inflight = received; this.changed(false);
      }
      if (received !== length) throw error(400, 'The connection was interrupted. Retry to resume.');
      await file.sync();
      job.offset += received; job.record.received = job.offset; job.touched = Date.now();job.record.resume.touched=job.touched;job.record.status='receiving';delete job.record.message;this.save();
      respond(res, 200, { offset: job.offset });
    } catch (err) {
      if (file) await file.truncate(offset).catch(() => {});
      job.offset=offset;job.record.received=offset;
      throw err;
    } finally {
      await file?.close().catch(() => {});
      job.inflight = 0; job.busy = false;
      if (job.cancelled) await this.cancel(job.record.id, job.record.message);
      this.changed();
    }
  }
  async complete(job) {
    if (job.busy || job.offset !== job.record.size) throw error(409, 'The file is not completely uploaded yet.');
    if (job.cancelled) throw error(410, 'Transfer cancelled.');
    job.busy = true;
    let destination;
    try {
      const digest = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(job.temp)) {
        if (job.cancelled) throw error(410, 'Transfer cancelled.');
        digest.update(chunk);
      }
      const ext = path.extname(job.record.name), base = job.record.name.slice(0, job.record.name.length - ext.length);
      for (let i = 0; i < 10_000; i++) {
        destination = path.join(job.folder, i ? `${base} (${i})${ext}` : job.record.name);
        try {
          try { await fsp.link(job.temp, destination); }
          catch (err) {
            if (!['ENOSYS', 'ENOTSUP', 'EPERM', 'EXDEV'].includes(err.code)) throw err;
            await fsp.copyFile(job.temp, destination, fs.constants.COPYFILE_EXCL);
          }
          break;
        }
        catch (err) { if (err.code !== 'EEXIST') throw err; destination = null; }
      }
      if (!destination) throw error(409, 'Too many files with the same name. Rename the file and retry.');
      if (job.cancelled) { await fsp.unlink(destination); throw error(410, 'Transfer cancelled.'); }
      await fsp.unlink(job.temp);
      job.record.status = 'completed'; job.record.completed = Date.now(); job.record.path = destination;
      job.record.name = path.basename(destination); job.record.sha256 = digest.digest('hex');
      delete job.record.temp;
      delete job.record.resume;
      this.jobs.delete(job.record.id); this.save(); this.changed();
      this.emit('received', { ...job.record });
      return await this.completedResult(job.record);
    } finally {
      job.busy = false;
      if (job.cancelled) await this.cancel(job.record.id, job.record.message);
    }
  }
  async completedResult(record) {
    if (record.recipientId && record.recipientId !== 'computer' && !record.relayOfferId) {
      const existing = this.state.outbox.find(o=>o.sourceTransferId === record.id);
      if (existing) { record.relayOfferId=existing.id;this.save(); }
    }
    if (record.recipientId && record.recipientId !== 'computer' && !record.relayOfferId) {
      if (!this.relayTasks.has(record.id)) {
        this.relayTasks.set(record.id, (async () => {
          if (!this.state.devices.some(d => d.id === record.deviceId)) throw error(401,'The sending device was removed.');
          const offers = await this.outbox.enqueue(record.recipientId,[record.path],{senderId:record.deviceId,senderName:record.deviceName,sourceTransferId:record.id});
          record.relayOfferId = offers[0].id; this.save(); this.changed();
        })());
      }
      try { await this.relayTasks.get(record.id); } finally { this.relayTasks.delete(record.id); }
    }
    return {name:record.name,sha256:record.sha256,recipientId:record.recipientId || 'computer',recipientName:record.recipientName || this.state.settings.computerName,relayOfferId:record.relayOfferId};
  }
  directory(viewer) {
    const summaries = this.messages.summary(viewer);
    return [{id:'computer',name:this.state.settings.computerName,online:true,profile:{kind:'computer',platform:'Windows',browser:'Lane'},publicKey:this.state.identityPublicKey},...this.state.devices.filter(d=>d.id !== viewer).map(d=>({id:d.id,name:d.name,online:Date.now()-d.lastSeen < 20_000,profile:d.profile,publicKey:d.publicKey || null}))].map(d=>({...d,generation:summaries.find(s=>s.deviceId === d.id)?.generation || '0',unread:summaries.find(s=>s.deviceId === d.id)?.unread || 0}));
  }
  sentFiles(deviceId) {
    return this.state.history.filter(h=>h.direction === 'incoming' && h.deviceId === deviceId && h.status === 'completed').slice(0,30).map(h=> {
      const relay = h.relayOfferId && this.state.history.find(r=>r.id === h.relayOfferId);
      return {id:h.id,name:h.name,size:h.size,created:h.completed,recipientId:h.recipientId || 'computer',recipientName:h.recipientName || this.state.settings.computerName,status:!h.recipientId || h.recipientId === 'computer' ? 'saved' : relay?.status === 'sent' ? 'downloaded' : ['cancelled','failed'].includes(relay?.status) ? 'unavailable' : 'ready'};
    });
  }
  async handle(req, res) {
    if (!isPrivate(req.socket.remoteAddress)) throw error(403, 'Lane accepts local network connections only.');
    const host = String(req.headers.host || '');
    const port=req.socket.encrypted ? this.tlsPort : this.port, scheme=req.socket.encrypted ? 'https' : 'http';
    const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`,`lane-${this.state.receiverId.slice(0,12)}.local:${port}`, ...addresses().map(a => `${a.address}:${port}`)]);
    if (!allowedHosts.has(host)) throw error(403, 'Use the local address shown in Lane.');
    const url = new URL(req.url, `${scheme}://${host}`);
    const route = url.pathname;
    // HTTP setup → HTTPS is schemefully cross-site. Permit only public, top-level
    // document navigation; never relax this check for APIs, assets or downloads.
    const publicNavigation = req.method === 'GET' && ['/', '/setup', '/lane-root.cer'].includes(route)
      && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    const origin = req.headers.origin;
    if (!publicNavigation && (origin && origin !== `${scheme}://${host}` || req.headers['sec-fetch-site'] === 'cross-site')) throw error(403, 'Cross-site requests are not allowed.');
    if(this.tls && req.method==='GET' && route==='/lane-root.cer') {
      res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="Lane-Local-CA.cer"','Cache-Control':'no-store'});return res.end(this.tls.certificate);
    }
    if(this.tls && req.method==='GET' && (route==='/setup' || !req.socket.encrypted && this.state.settings.httpsOnly && route==='/')) {
      const secureUrl=`https://${url.hostname}:${this.tlsPort}`;
      const html=(await fsp.readFile(path.join(__dirname,'mobile','setup.html'),'utf8')).replaceAll('{{SECURE_URL}}',secureUrl).replaceAll('{{CA_NAME}}',this.tls.name).replaceAll('{{FINGERPRINT}}',this.tls.fingerprint);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});return res.end(html);
    }
    if(!req.socket.encrypted && this.state.settings.httpsOnly) throw error(426,'HTTPS is required. Open the secure address shown in Lane → Settings.');
    if(req.method==='GET' && route==='/manifest.webmanifest'){
      const data=await fsp.readFile(path.join(__dirname,'mobile','manifest.webmanifest'));
      res.writeHead(200,{'Content-Type':'application/manifest+json','Cache-Control':'no-store'});return res.end(data);
    }
    if(req.method==='GET' && route==='/lane-icon.png'){
      const data=await fsp.readFile(path.join(__dirname,'..','assets','icon.png'));
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','Content-Length':data.length});return res.end(data);
    }
    if(req.method==='GET' && route==='/web-app.js'){
      const data=await fsp.readFile(path.join(__dirname,'mobile','web-app.js'));
      res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});return res.end(data);
    }
    const staticFiles = { '/': 'index.html', '/mobile.css': 'mobile.css', '/progress.css': 'progress.css', '/twoway.css':'twoway.css', '/mobile.js': 'mobile.js' };
    const sharedFiles = { '/controls.css':'controls.css','/discover.js':'discover.js','/discover.css':'discover.css','/recovery.js':'recovery.js','/message-format.js':'message-format.js', '/chat.js':'chat.js', '/chat.css':'chat.css', '/theme.js':'theme.js', '/theme.css':'theme.css', '/crypto-identity.js':'crypto-identity.js', '/crypto-vendor.js':'crypto-vendor.js', '/sound.js':'sound.js', '/message-tone.wav':'message-tone.wav' };
    sharedFiles['/connection-check.js']='connection-check.js';
    if (req.method === 'GET' && (staticFiles[route] || sharedFiles[route])) {
      const filename = sharedFiles[route] ? path.join(__dirname, 'shared', sharedFiles[route]) : path.join(__dirname, 'mobile', staticFiles[route]);
      const data = await fsp.readFile(filename);
      res.writeHead(200, { 'Content-Type': route.endsWith('.css') ? 'text/css' : route.endsWith('.js') ? 'text/javascript' : route.endsWith('.wav') ? 'audio/wav' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(data);
    }
    if (req.method === 'GET' && route === '/api/info') return respond(res, 200, { name: this.state.settings.computerName, receiverId: this.state.receiverId, accepting: this.state.settings.accepting, computerPublicKey:this.state.identityPublicKey, secure:Boolean(req.socket.encrypted),secureUrl:this.tls ? `https://${url.hostname}:${this.tlsPort}` : null,certificate:this.tls?.snapshot() || null,version:'0.10.0' });
    if (req.method === 'POST' && route === '/api/pair/request') {
      const ip = req.socket.remoteAddress;
      let limit = this.rate.get(ip);
      if (!limit || limit.until < Date.now()) { limit = { count: 0, until: Date.now() + 5 * 60_000 }; this.rate.set(ip, limit); }
      if (++limit.count > 10 || this.pending.size >= 50) throw error(429, 'Too many attempts. Try again in five minutes.');
      const body = await jsonBody(req);
      if (body.publicKey !== undefined && !validPublicKey(body.publicKey)) throw error(400, 'Invalid encryption key.');
      const previous = [...this.pending.values()].find(p => body.clientId && p.clientId === body.clientId && p.ip === ip && p.expires > Date.now() && p.code === String(body.code));
      if (previous) return respond(res, 200, { id:previous.id, status:'approved', token:previous.token });
      if (!this.pairing || this.pairing.expires < Date.now() || String(body.code) !== this.pairing.code) throw error(403, 'This pairing code is invalid or expired. Generate a new code in Lane.');
      let name = String(body.name || '').trim().slice(0, 50);
      if (!name) throw error(400, 'Give your device a name.');
      const requestedName = name;
      for (let n=2; this.state.devices.some(d=>d.name.toLowerCase() === name.toLowerCase()); n++) name = requestedName.slice(0,43) + ` (${n})`;
      const id = random();
      const token = random();
      const device = { id:crypto.randomUUID(), name, profile:deviceProfile(req),tokenHash:hash(token), pairedAt:Date.now(), lastSeen:Date.now(), publicKey:body.publicKey || null };
      this.state.devices.push(device);
      this.pending.set(id, { id, name, ip, clientId:String(body.clientId || '').slice(0,100), code:this.pairing.code, token, created:Date.now(), expires:Date.now() + 120_000, status:'approved' });
      this.pairing = null;
      this.save(); this.connected(device);
      return respond(res, 201, { id, token, status:'approved' });
    }
    if (req.method === 'GET' && route.startsWith('/api/pair/status/')) {
      const p = this.pending.get(route.split('/').pop());
      if (!p || p.expires < Date.now() || p.ip !== req.socket.remoteAddress) throw error(404, 'Pairing request expired. Try again.');
      respond(res, 200, { status: p.status, token: p.status === 'approved' ? p.token : undefined });
      // Keep an approved result briefly so a dropped response can safely be retried.
      return;
    }
    if (route === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie','lane_download=; HttpOnly; SameSite=Strict; Path=/download/; Max-Age=0');
      return respond(res,200,{ok:true});
    }
    const download = route.match(/^\/download\/([0-9a-f-]{36})$/);
    const device = this.authenticate(req, Boolean(download));
    if (download && ['GET','HEAD'].includes(req.method)) {
      return this.outbox.download(req,res,device,download[1],url.searchParams.get('preview') === '1');
    }
    if (req.method === 'GET' && route === '/api/device') {
      if(req.headers['user-agent'])device.profile=deviceProfile(req);
      this.setDownloadCookie(req,res);
      return respond(res, 200, { id:device.id, name: device.name, computerName: this.state.settings.computerName, computerPublicKey:this.state.identityPublicKey, publicKey:device.publicKey || null, accepting: this.state.settings.accepting, destinations:this.destinations(), inbox:this.outbox.list(device.id),devices:this.directory(device.id),sent:this.sentFiles(device.id),messageEvents:this.messages.eventsFor(device.id),nearby:this.discovery?.snapshot() || {status:'off',computers:[]} });
    }
    if (req.method === 'POST' && route === '/api/device/key') {
      const body=await jsonBody(req);
      if (!validPublicKey(body.publicKey)) throw error(400,'Invalid encryption key.');
      if (device.publicKey && !samePublicKey(device.publicKey,body.publicKey)) throw error(409,'This browser has lost its original encryption key. Existing encrypted messages require the original browser storage. Remove and pair the device again for new conversations.');
      device.publicKey=body.publicKey;this.save();this.changed();return respond(res,200,{ok:true});
    }
    if (req.method === 'PATCH' && route === '/api/device') {
      const body = await jsonBody(req);
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 50) throw error(400,'Enter a device name of up to 50 characters.');
      device.name = body.name.trim(); this.save(); this.changed(); return respond(res,200,{name:device.name});
    }
    if (route === '/api/messages' && req.method === 'GET') return respond(res, 200, this.messages.listFor(device.id,url.searchParams.get('peer') || 'computer', url.searchParams.get('revision') ?? -1, url.searchParams.get('limit')));
    if (route === '/api/messages' && req.method === 'POST') return respond(res, 201, this.messages.send(device.id, 'incoming', await jsonBody(req, 640 * 1024)));
    if (route === '/api/messages/ack' && req.method === 'POST') return respond(res, 200, this.messages.ackFor(device.id, await jsonBody(req, 48 * 1024)));
    if (route === '/api/messages' && req.method === 'DELETE') return respond(res,200,this.messages.clearFor(device.id,url.searchParams.get('peer') || 'computer'));
    const reaction = route.match(/^\/api\/messages\/([0-9a-f-]{36})\/reaction$/);
    if (reaction && req.method === 'POST') return respond(res,200,this.messages.react(device.id,reaction[1],(await jsonBody(req)).emoji));
    if (req.method === 'GET' && route === '/api/inbox') return respond(res,200,{files:this.outbox.list(device.id)});
    if (req.method === 'POST' && route === '/api/uploads') return respond(res, 201, await this.createUpload(device, await jsonBody(req)));
    const match = route.match(/^\/api\/uploads\/([0-9a-f-]{36})(\/complete)?$/);
    if (match) {
      const job = this.jobs.get(match[1]);
      if (!job || job.record.deviceId !== device.id) {
        const completed = this.state.history.find(h => h.id === match[1] && h.deviceId === device.id && h.status === 'completed');
        if (completed && match[2] && req.method === 'POST') return respond(res, 200, await this.completedResult(completed));
        if (completed && !match[2] && req.method === 'GET') return respond(res, 200, { offset: completed.size, size: completed.size, completed: true, ...await this.completedResult(completed) });
        throw error(404, 'Transfer not found. Send the file again.');
      }
      if (req.method === 'GET' && !match[2]) return respond(res, 200, { offset: job.offset, size: job.record.size });
      if (req.method === 'DELETE' && !match[2]) { await this.cancel(match[1]); return respond(res, 200, { ok: true }); }
      if (!this.state.settings.accepting) throw error(423, 'Receiving is paused on the computer. Retry when it resumes.');
      if (req.method === 'PUT' && !match[2]) return this.chunk(req, res, job);
      if (req.method === 'POST' && match[2]) return respond(res, 200, await this.complete(job));
    }
    throw error(404, 'Not found.');
  }
}
module.exports = { Receiver, safeName, isPrivate, CHUNK_SIZE };
