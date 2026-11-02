const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const MAX_TEXT = 100_000;
const REACTIONS = ['❤️', '👍', '😊', '😂', '🎉', '👀'];
const {validPublicKey,samePublicKey}=require('./public-key.cjs');

class Messages {
  constructor(receiver) {
    this.receiver = receiver;
    this.filename = path.join(receiver.dataDir, 'messages.json');
    this.data = fs.existsSync(this.filename) ? JSON.parse(fs.readFileSync(this.filename, 'utf8')) : { revision: 0, sequence: 0, items: [] };
    this.data.generations ||= {};
    for (const m of this.data.items) {
      m.senderId ||= m.direction === 'outgoing' ? 'computer' : m.deviceId;
      m.recipientId ||= m.direction === 'outgoing' ? m.deviceId : 'computer';
      m.reactions ||= [];
    }
  }
  device(id) {
    return this.receiver.state.devices.find(d => d.id === id) || fail(404, 'This device is no longer paired.');
  }
  commit() {
    this.data.revision++;
    fs.writeFileSync(this.filename + '.tmp', JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(this.filename + '.tmp', this.filename);
    this.receiver.changed();
  }
  participant(id) { return id === 'computer' ? { id, name:this.receiver.state.settings.computerName } : this.device(id); }
  between(m, a, b) { return m.senderId === a && m.recipientId === b || m.senderId === b && m.recipientId === a; }
  pairKey(a, b) { return crypto.createHash('sha256').update(JSON.stringify([a,b].sort())).digest('hex'); }
  generation(a, b) { return this.data.generations[this.pairKey(a,b)] || '0'; }
  eventsFor(viewer) {
    return this.data.items.filter(m=>m.recipientId===viewer).slice(-50).map(m=>({id:m.id,seq:m.seq,senderId:m.senderId,senderName:this.participant(m.senderId).name}));
  }
  summary(viewer = 'computer') {
    return [{id:'computer'}, ...this.receiver.state.devices].filter(d => d.id !== viewer).map(d => {
      const items = this.data.items.filter(m => this.between(m, viewer, d.id));
      return { deviceId: d.id, generation:this.generation(viewer,d.id), count: items.length, unread: items.filter(m => m.recipientId === viewer && !m.readAt).length };
    });
  }
  list(deviceId, revision = -1, limit = 50) {
    return this.listFor('computer', deviceId, revision, limit);
  }
  listFor(viewer, peer, revision = -1, limit = 50) {
    this.participant(viewer); this.participant(peer);
    if (viewer === peer) fail(400, 'Choose another device.');
    limit = Math.min(1000, Math.max(50, Number(limit) || 50));
    const generation=this.generation(viewer,peer);
    if (Number(revision) === this.data.revision) return { unchanged: true, revision: this.data.revision, generation };
    const items = this.data.items.filter(m => this.between(m, viewer, peer));
    return { revision: this.data.revision, generation, total: items.length, messages: items.slice(-limit).map(m => ({...m, direction:m.senderId === viewer ? 'outgoing' : 'incoming'})) };
  }
  send(deviceId, direction, body) {
    const device = this.device(deviceId);
    const encrypted = body?.encrypted === true;
    const validPublic = validPublicKey(body?.publicKey);
    const validCipher = encrypted && typeof body.text === 'string' && body.text.length > 0 && body.text.length <= 400_024 && body.cryptoVersion === 2 && /^[A-Za-z0-9+/]+={0,2}$/.test(body.text) && body.text.length % 4 === 0 && Buffer.from(body.text,'base64').length >= 16 && typeof body.iv === 'string' && /^[A-Za-z0-9+/]{16}$/.test(body.iv) && validPublic;
    const validPlain = !encrypted && typeof body?.text === 'string' && body.text.trim() && body.text.length <= MAX_TEXT;
    if (!body || (!validCipher && !validPlain) || !['plain', 'markdown'].includes(body.format) || typeof body.clientId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.clientId)) fail(400, 'Enter a message of up to 100,000 characters.');
    const senderId = direction === 'outgoing' ? 'computer' : deviceId;
    const recipientId = direction === 'outgoing' ? deviceId : body.recipientId || 'computer';
    const recipient=this.participant(recipientId);
    if (senderId === recipientId) fail(400, 'Choose another device.');
    if ((body.generation ?? '0') !== this.generation(senderId,recipientId)) fail(409, 'This conversation was cleared. Refresh before sending a new message.');
    const senderKey=senderId==='computer' ? this.receiver.state.identityPublicKey : device.publicKey;
    const recipientKey=recipientId==='computer' ? this.receiver.state.identityPublicKey : recipient.publicKey;
    if (!encrypted && (senderKey || recipientKey)) fail(409,'Encrypted messages are required. Reload Lane on both devices.');
    if (encrypted && !recipientKey) fail(409,'Open Lane on the recipient device to enable encryption first.');
    if (encrypted) {
      const registeredKey = senderId === 'computer' ? this.receiver.state.identityPublicKey : device.publicKey;
      if (!samePublicKey(body.publicKey, registeredKey)) fail(409, 'This device encryption key is not registered. Pair the device again.');
    }
    const existing = this.data.items.find(m => m.senderId === senderId && m.clientId === body.clientId);
    if (existing) {
      if (existing.text !== body.text || existing.format !== body.format || existing.recipientId !== recipientId || existing.iv !== (body.iv || null) || existing.cryptoVersion !== (encrypted ? 2 : undefined)) fail(409, 'This message ID is already in use.');
      return existing;
    }
    if (this.data.items.filter(m => this.between(m,senderId,recipientId)).length >= 1000 || Buffer.byteLength(JSON.stringify(this.data)) + Buffer.byteLength(JSON.stringify(body)) > 32 * 1024 * 1024) fail(507, 'Message storage is full. Save any notes you need, then clear a conversation.');
    const item = { id: crypto.randomUUID(), seq: ++this.data.sequence, deviceId, direction, senderId, recipientId, reactions:[], clientId: body.clientId, encrypted, cryptoVersion:encrypted ? 2 : undefined, iv: encrypted ? body.iv : null, senderPublicKey: encrypted ? body.publicKey : null, text: body.text, format: body.format, created: Date.now(), receivedAt: recipientId === 'computer' ? Date.now() : null, readAt: null };
    this.data.items.push(item);
    try { this.commit(); } catch (err) { this.data.items.pop(); throw err; }
    if (recipientId === 'computer') this.receiver.emit('message', { deviceId, name: device.name });
    return item;
  }
  acknowledge(deviceId, direction, body) {
    this.device(deviceId);
    return this.ackFor(direction === 'incoming' ? 'computer' : deviceId, body);
  }
  ackFor(viewer, body) {
    this.participant(viewer);
    if (!body || !Array.isArray(body.ids) || body.ids.length > 1000 || body.ids.some(id => typeof id !== 'string') || typeof body.read !== 'boolean') fail(400, 'Invalid message receipt.');
    const ids = new Set(body.ids);
    let changed = false;
    for (const m of this.data.items) {
      if (m.recipientId !== viewer || !ids.has(m.id)) continue;
      if (!m.receivedAt) { m.receivedAt = Date.now(); changed = true; }
      if (body.read && !m.readAt) { m.readAt = Date.now(); changed = true; }
    }
    if (changed) this.commit();
    return { ok: true };
  }
  get(deviceId, id) {
    this.device(deviceId);
    return this.data.items.find(m => this.between(m,'computer',deviceId) && m.id === id) || fail(404, 'Message not found.');
  }
  clear(deviceId) {
    return this.clearFor('computer',deviceId);
  }
  clearFor(viewer, peer) {
    this.participant(viewer); this.participant(peer);
    if(viewer===peer)fail(400,'Choose another device.');
    const previous=this.data.items,key=this.pairKey(viewer,peer),old=this.data.generations[key],revision=this.data.revision;
    // Retain only a random epoch, never the deleted bodies or receipts. An old
    // client/backup must not resurrect a message after its deduplication ID is gone.
    this.data.generations[key]=crypto.randomUUID();
    this.data.items=previous.filter(m=>!this.between(m,viewer,peer));
    try { this.commit(); } catch(err) {
      this.data.items=previous;this.data.revision=revision;
      if(old)this.data.generations[key]=old;else delete this.data.generations[key];
      throw err;
    }
    return {ok:true,generation:this.data.generations[key]};
  }
  removeDevice(id) {
    this.data.items = this.data.items.filter(m => m.senderId !== id && m.recipientId !== id);
    this.commit();
  }
  react(viewer, id, emoji) {
    this.participant(viewer);
    if (emoji !== null && !REACTIONS.includes(emoji)) fail(400, 'Choose one of the available reactions.');
    const m = this.data.items.find(m => m.id === id && [m.senderId,m.recipientId].includes(viewer)) || fail(404,'Message not found.');
    if ((m.reactions.find(r => r.actorId === viewer)?.emoji || null) === emoji) return {ok:true};
    m.reactions = m.reactions.filter(r => r.actorId !== viewer);
    if (emoji) m.reactions.push({actorId:viewer,emoji});
    this.commit();
    return {ok:true};
  }
}
module.exports = { Messages, MAX_TEXT, REACTIONS };
