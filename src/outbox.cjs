const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const failure = (status, message) => Object.assign(new Error(message), { status });
const previewTypes = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.webp':'image/webp', '.heic':'image/heic', '.heif':'image/heif', '.avif':'image/avif', '.mp4':'video/mp4', '.m4v':'video/mp4', '.mov':'video/quicktime', '.webm':'video/webm', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.pdf':'application/pdf' };
function rangeOf(header, size) {
  if (!header) return { start:0, end:size - 1, partial:false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) throw failure(416, 'This download range is not available.');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) throw failure(416, 'This download range is not available.');
  return { start, end, partial:true };
}
class Outbox {
  constructor(receiver) {
    this.receiver = receiver;
    this.streams = new Map();
    receiver.state.outbox ||= [];
    for (const offer of receiver.state.outbox) {
      const record = this.record(offer.id);
      if (record?.status === 'sending') { record.status = 'queued'; record.message = 'Ready to download again.'; }
    }
  }
  record(id) { return this.receiver.state.history.find(h => h.id === id); }
  public(offer) {
    const record = this.record(offer.id);
    return { id:offer.id, deviceId:offer.deviceId, senderId:offer.senderId || 'computer', senderName:offer.senderName || this.receiver.state.settings.computerName, name:offer.name, size:offer.size, created:offer.created, expires:offer.expires, preview:Boolean(previewTypes[path.extname(offer.name).toLowerCase()]), status:record?.status || 'queued', transferred:record?.received || 0 };
  }
  list(deviceId) { return this.receiver.state.outbox.filter(o => o.expires > Date.now() && (!deviceId || o.deviceId === deviceId)).map(o => this.public(o)); }
  async enqueue(deviceId, filenames, source = {}) {
    const device = this.receiver.state.devices.find(d => d.id === deviceId);
    if (!device) throw failure(404, 'Pair the receiving device first.');
    if (!Array.isArray(filenames) || !filenames.length || filenames.length > 100) throw failure(400, 'Choose between 1 and 100 files.');
    if (this.receiver.state.outbox.length + filenames.length > 300) throw failure(429, 'Remove some shared files before adding more.');
    const selected = [];
    for (const filename of filenames) {
      if (!path.isAbsolute(filename)) throw failure(400, 'Choose files using the file picker.');
      const stats = await fsp.stat(filename).catch(() => { throw failure(404, 'One of the selected files is no longer available.'); });
      if (!stats.isFile()) throw failure(400, 'Choose individual files. Folder transfers are not supported.');
      selected.push({ id:crypto.randomUUID(), deviceId, ...source, path:filename, name:path.basename(filename), size:stats.size, mtime:stats.mtimeMs, created:Date.now(), expires:Date.now() + 24 * 60 * 60_000, ranges:[] });
    }
    // The native picker selects sources. No arbitrary path is accepted over HTTP.
    if (!this.receiver.state.devices.some(d => d.id === deviceId)) throw failure(404, 'The receiving device was removed.');
    if (source.senderId && !this.receiver.state.devices.some(d=>d.id === source.senderId)) throw failure(404,'The sending device was removed.');
    if (this.receiver.state.outbox.length + selected.length > 300) throw failure(429,'Remove some shared files before adding more.');
    for (const offer of selected) {
      this.receiver.state.outbox.push(offer);
      this.receiver.state.history.unshift({ id:offer.id, name:offer.name, path:offer.path, size:offer.size, received:0, deviceId, deviceName:device.name, senderName:source.senderName, direction:'outgoing', status:'queued', created:offer.created });
    }
    this.receiver.save(); this.receiver.changed();
    return selected.map(o => this.public(o));
  }
  cancel(id, message = 'Sharing stopped.') {
    const offer = this.receiver.state.outbox.find(o => o.id === id);
    if (!offer) return;
    this.receiver.state.outbox = this.receiver.state.outbox.filter(o => o.id !== id);
    for (const transfer of this.streams.get(id) || []) { transfer.cancelled = true; transfer.stream?.destroy(); transfer.res.destroy(); }
    this.streams.delete(id);
    const record = this.record(id);
    if (record && record.status !== 'sent') { record.status = 'cancelled'; record.message = message; }
    this.receiver.save(); this.receiver.changed();
  }
  sweep() { for (const offer of [...this.receiver.state.outbox]) if (offer.expires < Date.now()) this.cancel(offer.id, 'This file offer expired after 24 hours.'); }
  covered(offer, start, end) {
    const ranges = [...offer.ranges, [start,end]].sort((a,b)=>a[0]-b[0]);
    const merged = [];
    for (const next of ranges) {
      const last = merged.at(-1);
      if (last && next[0] <= last[1] + 1) last[1] = Math.max(last[1], next[1]);
      else merged.push([...next]);
    }
    offer.ranges = merged;
    return merged.reduce((n,[a,b])=>n+Math.max(0,b-a+1),0);
  }
  async download(req, res, device, id, preview) {
    const offer = this.receiver.state.outbox.find(o => o.id === id && o.deviceId === device.id && o.expires > Date.now());
    if (!offer) throw failure(404, 'This file is no longer shared with this device. Ask the computer to send it again.');
    const type = previewTypes[path.extname(offer.name).toLowerCase()];
    if (preview && !type) throw failure(415, 'Download this file to open it in a compatible app.');
    const handle = await fsp.open(offer.path, 'r').catch(() => { throw failure(404, 'The original file was moved or deleted. Ask the computer to send it again.'); });
    let transfer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== offer.size || stat.mtimeMs !== offer.mtime) throw failure(409, 'The original file changed. Ask the computer to select it again.');
      const range = rangeOf(req.headers.range, offer.size);
      const length = Math.max(0, range.end - range.start + 1);
      const fallback = offer.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
      const encoded = encodeURIComponent(offer.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
      const headers = {
        'Content-Type':preview ? type : 'application/octet-stream',
        'Content-Disposition':`${preview ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        'Content-Length':length, 'Accept-Ranges':'bytes', 'Cache-Control':'no-store',
        'Content-Security-Policy':"sandbox allow-downloads; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
      };
      if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${offer.size}`;
      res.writeHead(range.partial ? 206 : 200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const record = this.record(id);
      const alreadySent = record?.status === 'sent';
      transfer = { res, preview, count:0, cancelled:false };
      if (!this.streams.has(id)) this.streams.set(id,new Set());
      this.streams.get(id).add(transfer);
      if (!preview && record && !alreadySent) { record.status = 'sending'; this.receiver.changed(); }
      if (length) {
        transfer.stream = handle.createReadStream({ start:range.start, end:range.end, autoClose:false });
        transfer.stream.on('data', chunk => {
          transfer.count += chunk.length;
          if (!preview && record && !alreadySent) { record.received = Math.min(offer.size, Math.max(record.received, range.start + transfer.count)); this.receiver.changed(false); }
        });
        await pipeline(transfer.stream,res);
      } else res.end();
      if (!preview && !transfer.cancelled && record) {
        const count = this.covered(offer,range.start,range.end);
        record.received = count;
        record.status = count >= offer.size ? 'sent' : 'queued';
        if (record.status === 'sent') { record.completed = Date.now(); record.message = 'Sent to the browser. Saving to Files or Photos is controlled by the receiving device.'; }
        this.receiver.save(); this.receiver.changed();
      }
    } catch (err) {
      const record = this.record(id);
      if (transfer && !preview && !transfer.cancelled && record && record.status !== 'sent') {
        record.status = 'queued'; record.received = offer.ranges.reduce((n,[a,b])=>n+b-a+1,0); record.message = 'Download interrupted. Ready to retry.';
        this.receiver.save(); this.receiver.changed();
      }
      throw err;
    } finally {
      await handle.close().catch(()=>{});
      if (transfer) this.streams.get(id)?.delete(transfer);
      if (!this.streams.get(id)?.size) this.streams.delete(id);
    }
  }
}
module.exports = { Outbox, rangeOf };
