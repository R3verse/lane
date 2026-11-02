const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const { Receiver, safeName, isPrivate, CHUNK_SIZE } = require('../src/server.cjs');
const messageFormat = require('../src/shared/message-format.js');
let receiver, root, base, token;
async function request(route, options = {}) {
  const result = await fetch(base + route, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const data = await result.json(); return { status:result.status, data };
}
async function pair(name = 'Test phone') {
  const code = receiver.openPairing().code;
  const p = await request('/api/pair/request', { method:'POST', body:JSON.stringify({ code, name }) });
  assert.equal(p.status, 201);
  assert.equal(p.data.status,'approved');
  return p.data.token;
}
async function create(name, size, clientId = crypto.randomUUID()) {
  return request('/api/uploads', { method:'POST', body:JSON.stringify({ name, size, clientId }) });
}
async function send(name, data) {
  const created = await create(name, data.length); assert.equal(created.status,201);
  const id = created.data.id;
  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const chunk = await request('/api/uploads/' + id, { method:'PUT', headers: { 'X-File-Offset':String(offset) }, body:data.subarray(offset, offset + CHUNK_SIZE) });
    assert.equal(chunk.status,200);
  }
  const completed = await request('/api/uploads/' + id + '/complete', { method:'POST' });
  assert.equal(completed.status,200);
  return { ...completed.data, id };
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lane-test-'));
  receiver = new Receiver({ dataDir:path.join(root,'state'), defaultFolder:path.join(root,'inbox'), host:'127.0.0.1', port:0 });
  await receiver.start(); base = `http://127.0.0.1:${receiver.port}`; token = '';
});
afterEach(async () => {
  await receiver.stop();
  // Remove only the known, independently created temporary test root.
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(root).startsWith('lane-test-'));
  await fs.rm(root, { recursive:true, force:true });
});
test('project destinations expose labels only, reject unapproved paths, and preserve in-progress targets',async()=>{
  token=await pair();
  const folder=path.join(root,'project');
  const destination=await receiver.addDestination('Studio',folder);
  const device=(await request('/api/device')).data;
  assert.deepEqual(device.destinations,[{id:'default',name:'Receiving folder'},{id:destination.id,name:'Studio'}]);
  assert.ok(!JSON.stringify(device).includes(folder));
  await assert.rejects(receiver.addDestination('studio',folder),/already/);
  await assert.rejects(receiver.addDestination('Bad','relative/path'),/absolute/);
  const clientId=crypto.randomUUID();
  const body={name:'project.txt',size:5,clientId,destinationId:destination.id};
  const bad=await request('/api/uploads',{method:'POST',body:JSON.stringify({...body,destinationId:'../../escape'})});assert.equal(bad.status,404);
  const created=await request('/api/uploads',{method:'POST',body:JSON.stringify(body)});assert.equal(created.status,201);
  const changed=await request('/api/uploads',{method:'POST',body:JSON.stringify({...body,destinationId:'default'})});assert.equal(changed.status,409);
  receiver.removeDestination(destination.id);
  const fresh=await request('/api/uploads',{method:'POST',body:JSON.stringify({...body,clientId:crypto.randomUUID()})});assert.equal(fresh.status,404);
  await receiver.stop();receiver=new Receiver({dataDir:path.join(root,'state'),defaultFolder:path.join(root,'inbox'),host:'127.0.0.1',port:0});await receiver.start();base=`http://127.0.0.1:${receiver.port}`;
  assert.equal((await request('/api/uploads',{method:'POST',body:JSON.stringify(body)})).status,201);
  assert.equal((await request('/api/uploads/'+created.data.id,{method:'PUT',headers:{'X-File-Offset':'0'},body:Buffer.from('hello')})).status,200);
  assert.equal((await request('/api/uploads/'+created.data.id+'/complete',{method:'POST'})).status,200);
  assert.equal(await fs.readFile(path.join(folder,'project.txt'),'utf8'),'hello');
  assert.equal(receiver.state.history[0].destinationName,'Studio');
});
test('desktop conversation mute persists independently of unread messages',async()=>{
  token=await pair();const id=receiver.state.devices[0].id;
  receiver.muteConversation(id,true);assert.deepEqual(receiver.snapshot().mutedConversations,[id]);
  assert.throws(()=>receiver.muteConversation('not-paired',true),/paired/);
  const stored=JSON.parse(await fs.readFile(path.join(root,'state','state.json'),'utf8'));assert.deepEqual(stored.mutedConversations,[id]);
  receiver.muteConversation(id,false);assert.deepEqual(receiver.snapshot().mutedConversations,[]);
});
test('legacy paired browsers can register a public key once, without losing history or permitting replacement',async()=>{
  token=await pair();
  const keys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicKey=keys.publicKey.export({format:'jwk'});
  const route='/api/device/key',body=JSON.stringify({publicKey});
  assert.equal((await request(route,{method:'POST',body})).status,200);
  assert.equal((await request(route,{method:'POST',body})).status,200);
  assert.deepEqual((await request('/api/device')).data.publicKey,publicKey);
  const other=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'});
  assert.equal((await request(route,{method:'POST',body:JSON.stringify({publicKey:other})})).status,409);
  assert.equal((await request(route,{method:'POST',body:JSON.stringify({publicKey:keys.privateKey.export({format:'jwk'})})})).status,400);
  const tone=await fetch(base+'/message-tone.wav');
  assert.equal(tone.status,200);assert.equal(tone.headers.get('content-type'),'audio/wav');
  assert.equal(Buffer.from(await tone.arrayBuffer()).subarray(0,4).toString(),'RIFF');
});

test('one-use pairing connects directly, retries are idempotent, credentials persist', async () => {
  assert.equal((await create('secret.txt',1)).status,401);
  const code = receiver.openPairing().code;
  const body = JSON.stringify({name:'Phone',code,clientId:crypto.randomUUID()});
  const p = await request('/api/pair/request',{method:'POST',body});
  assert.equal(p.data.status,'approved');
  assert.equal((await request('/api/pair/request',{method:'POST',body})).data.token,p.data.token);
  assert.equal(receiver.state.devices.length,1);
  assert.equal(receiver.snapshot().connectionNotice.name,'Phone');
  assert.equal(receiver.snapshot().pairing,null);
  assert.equal((await request('/api/pair/request',{method:'POST',body:JSON.stringify({name:'Other',code})})).status,403);
  token = p.data.token;
  assert.equal((await request('/api/device')).status,200);
  const saved = JSON.parse(await fs.readFile(path.join(root,'state','state.json'),'utf8'));
  assert.equal(saved.devices[0].tokenHash,crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.stringify(saved).includes(token),false);
  receiver.openPairing(); receiver.pairing.expires = Date.now() - 1;
  assert.equal((await request('/api/pair/request',{method:'POST',body:JSON.stringify({name:'Phone',code:receiver.pairing.code})})).status,403);
});
test('cross-origin and DNS rebinding requests are refused', async () => {
  token = await pair();
  assert.equal((await request('/api/device',{headers:{Origin:'https://attacker.example'}})).status,403);
  const rebound = await new Promise((resolve,reject) => {
    const req = http.get(base+'/api/device',{headers:{Host:'attacker.example:'+receiver.port,Authorization:'Bearer '+token}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);
  });
  assert.equal(rebound,403);
  assert.equal((await request('/api/device',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await request('/api/device',{headers:{Origin:base}})).status,200);
});
test('arbitrary binary files remain byte-for-byte identical across multiple chunks', async () => {
  token = await pair();
  const data = crypto.randomBytes(CHUNK_SIZE * 2 + 457);
  const result = await send('video.MOV',data);
  assert.deepEqual(await fs.readFile(path.join(root,'inbox',result.name)),data);
  assert.equal(result.sha256,crypto.createHash('sha256').update(data).digest('hex'));
  assert.equal(receiver.snapshot().active.length,0);
  assert.equal(receiver.snapshot().history[0].status,'completed');
  assert.deepEqual(await fs.readdir(path.join(root,'inbox','.lane-incoming')),[]);
});
test('duplicate names are preserved; file types and zero-byte files are accepted', async () => {
  token = await pair();
  for (const name of ['photo.heic','report.pdf','archive.zip','program.exe','empty.txt']) {
    const payload = name === 'empty.txt' ? Buffer.alloc(0) : Buffer.from('First '+name);
    const first = await send(name,payload), second = await send(name,Buffer.from('Second'));
    assert.equal(first.name,name);
    assert.match(second.name,/ \(1\)\./);
    assert.deepEqual(await fs.readFile(path.join(root,'inbox',first.name)),payload);
  }
});
test('unsafe names are confined to the destination and Windows reserved names are normalized', async () => {
  token = await pair();
  for (const name of ['../../outside.txt','C:\\Windows\\CON.pdf','hello.txt:secret','PRN','æøå 📷.png']) {
    const result = await send(name,Buffer.from('safe'));
    assert.ok(!/[\\/:]/.test(result.name));
    assert.ok((await fs.stat(path.join(root,'inbox',result.name))).isFile());
  }
  assert.equal(safeName('CON.txt'),'_CON.txt');
  assert.equal(safeName('../..'),'Untitled file');
  assert.equal(await fs.access(path.join(root,'outside.txt')).then(()=>true,()=>false),false);
});
test('retries resume at the committed offset and completion is idempotent', async () => {
  token = await pair();
  const c = await create('resume.bin',6,'same-client-request');
  assert.equal((await create('resume.bin',6,'same-client-request')).data.id,c.data.id);
  const route = '/api/uploads/'+c.data.id;
  assert.equal((await request(route,{method:'PUT',headers:{'X-File-Offset':'0'},body:Buffer.from('abc')})).status,200);
  assert.equal((await request(route)).data.offset,3);
  assert.equal((await request(route,{method:'PUT',headers:{'X-File-Offset':'0'},body:Buffer.from('abc')})).status,409);
  assert.equal((await request(route+'/complete',{method:'POST'})).status,409);
  assert.equal((await request(route,{method:'PUT',headers:{'X-File-Offset':'3'},body:Buffer.from('def')})).status,200);
  const finished = await request(route+'/complete',{method:'POST'});
  assert.equal(finished.status,200);
  assert.deepEqual((await request(route+'/complete',{method:'POST'})).data,finished.data);
  assert.equal((await request(route)).data.completed,true);
  assert.equal(await fs.readFile(path.join(root,'inbox','resume.bin'),'utf8'),'abcdef');
});
test('aborted chunks are rolled back and can be retried without corruption', async () => {
  token = await pair();
  const c = await create('interrupted.bin',100000);
  await new Promise(resolve => {
    const req = http.request(base+'/api/uploads/'+c.data.id,{method:'PUT',headers:{Authorization:'Bearer '+token,'X-File-Offset':'0','Content-Length':'100000'}},()=>{});
    req.on('error',()=>resolve()); req.write(Buffer.alloc(20000,7));
    setTimeout(()=>{req.destroy();resolve();},80);
  });
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal((await request('/api/uploads/'+c.data.id)).data.offset,0);
  const data = Buffer.alloc(100000,5);
  assert.equal((await request('/api/uploads/'+c.data.id,{method:'PUT',headers:{'X-File-Offset':'0'},body:data})).status,200);
  assert.equal((await request('/api/uploads/'+c.data.id+'/complete',{method:'POST'})).status,200);
  assert.deepEqual(await fs.readFile(path.join(root,'inbox','interrupted.bin')),data);
});
test('one device cannot read, complete or cancel another device upload', async () => {
  token = await pair('A'); const c = await create('a.txt',3);
  token = await pair('B');
  for (const method of ['GET','DELETE']) assert.equal((await request('/api/uploads/'+c.data.id,{method})).status,404);
  assert.equal((await request('/api/uploads/'+c.data.id+'/complete',{method:'POST'})).status,404);
});
test('removing a device revokes its token and removes partial files', async () => {
  token = await pair(); const c = await create('part.txt',3);
  const temp = receiver.jobs.get(c.data.id).temp;
  await receiver.revoke(receiver.state.devices[0].id);
  assert.equal((await request('/api/device')).status,401);
  assert.equal(receiver.jobs.size,0);
  assert.equal(await fs.access(temp).then(()=>true,()=>false),false);
});
test('pause/resume and destination changes keep existing transfers in their original folder', async () => {
  token = await pair(); const c = await create('old.txt',0);
  await receiver.updateSettings({ accepting:false });
  assert.equal((await create('blocked.txt',0)).status,423);
  assert.equal((await request('/api/uploads/'+c.data.id+'/complete',{method:'POST'})).status,423);
  await receiver.updateSettings({accepting:true,folder:path.join(root,'new-folder')});
  assert.equal((await request('/api/uploads/'+c.data.id+'/complete',{method:'POST'})).status,200);
  await send('new.txt',Buffer.from('new'));
  assert.ok((await fs.stat(path.join(root,'inbox','old.txt'))).isFile());
  assert.ok((await fs.stat(path.join(root,'new-folder','new.txt'))).isFile());
});
test('credentials and completed history survive a receiver restart', async () => {
  token = await pair(); await send('persist.txt',Buffer.from('persist'));
  await receiver.stop();
  receiver = new Receiver({dataDir:path.join(root,'state'),defaultFolder:'unused',host:'127.0.0.1',port:0});
  await receiver.start(); base = `http://127.0.0.1:${receiver.port}`;
  assert.equal((await request('/api/device')).status,200);
  assert.equal(receiver.snapshot().history[0].name,'persist.txt');
  receiver.clearHistory();
  assert.equal(receiver.snapshot().history.length,0);
  assert.equal(await fs.readFile(path.join(root,'inbox','persist.txt'),'utf8'),'persist');
});
test('committed chunks resume after receiver restart, discard uncommitted tails and keep device ownership',async()=>{
  token=await pair();const content=crypto.randomBytes(CHUNK_SIZE+301),clientId=crypto.randomUUID();
  const created=await create('restart.bin',content.length,clientId),id=created.data.id;
  assert.equal((await request('/api/uploads/'+id,{method:'PUT',headers:{'X-File-Offset':'0'},body:content.subarray(0,CHUNK_SIZE)})).status,200);
  const temp=receiver.jobs.get(id).temp;await fs.appendFile(temp,Buffer.from('uncommitted tail'));
  await receiver.stop();receiver=new Receiver({dataDir:path.join(root,'state'),defaultFolder:'unused',host:'127.0.0.1',port:0});await receiver.start();base=`http://127.0.0.1:${receiver.port}`;
  assert.equal((await request('/api/uploads/'+id)).data.offset,CHUNK_SIZE);assert.equal((await fs.stat(temp)).size,CHUNK_SIZE);
  assert.equal((await create('restart.bin',content.length,clientId)).data.id,id);
  assert.equal((await create('different.bin',content.length,clientId)).status,409);
  const original=token;token=await pair('Other');assert.equal((await request('/api/uploads/'+id)).status,404);token=original;
  assert.equal((await request('/api/uploads/'+id,{method:'PUT',headers:{'X-File-Offset':String(CHUNK_SIZE)},body:content.subarray(CHUNK_SIZE)})).status,200);
  assert.equal((await request('/api/uploads/'+id+'/complete',{method:'POST'})).status,200);assert.deepEqual(await fs.readFile(path.join(root,'inbox','restart.bin')),content);
  assert.equal(receiver.state.history.find(h=>h.id===id).resume,undefined);
});
test('invalid sizes, full disks and too many unfinished uploads are rejected', async () => {
  token = await pair();
  for(const size of [-1,0.5,'4',null]) assert.equal((await create('bad.bin',size)).status,400);
  assert.equal((await create('too-big.bin',Number.MAX_SAFE_INTEGER-1)).status,507);
  for(let i=0;i<4;i++) assert.equal((await create(i+'.bin',100)).status,201);
  assert.equal((await create('limit.bin',100)).status,429);
});
test('public addresses are rejected; only local sender assets are served', async () => {
  assert.equal(isPrivate('8.8.8.8'),false); assert.equal(isPrivate('::ffff:192.168.1.2'),true); assert.equal(isPrivate('172.32.0.1'),false);
  const page = await fetch(base); assert.equal(page.status,200);
  assert.match(page.headers.get('Content-Security-Policy'),/default-src 'self'/);
  assert.match(await page.text(),/Photos &amp; Videos|Photos & Videos/);
  const scripts = await fetch(base+'/mobile.js'); assert.equal(scripts.status,200);
  assert.equal((await request('/api/pair/request',{method:'POST',body:'not JSON'})).status,400);
});
test('desktop offers stream exact bytes to the selected device using a restricted download cookie', async () => {
  token = await pair();
  const device = receiver.state.devices[0];
  const payload = crypto.randomBytes(CHUNK_SIZE * 2 + 33);
  const filename = path.join(root,'værdifuld 📷.mov'); await fs.writeFile(filename,payload);
  const [offer] = await receiver.outbox.enqueue(device.id,[filename]);
  const inbox = (await request('/api/inbox')).data.files;
  assert.equal(inbox[0].name,path.basename(filename));
  assert.equal('path' in inbox[0],false);
  const health = await fetch(base+'/api/device',{headers:{Authorization:'Bearer '+token}});
  const cookie = health.headers.get('set-cookie').split(';')[0];
  assert.match(health.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Path=\/download\//);
  assert.equal((await fetch(base+'/download/'+offer.id)).status,401);
  const download = await fetch(base+'/download/'+offer.id,{headers:{Cookie:cookie}});
  assert.equal(download.status,200); assert.match(download.headers.get('content-disposition'),/attachment; filename=.*filename\*=UTF-8''/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),payload);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(receiver.outbox.record(offer.id).status,'sent');
  assert.equal((await request('/api/device',{headers:{Authorization:'',Cookie:cookie}})).status,401,'Download cookie cannot authorize API operations');
  assert.deepEqual(await fs.readFile(filename),payload);
});
test('outgoing files support HEAD and ranges without claiming partial downloads are complete', async () => {
  token = await pair(); const filename = path.join(root,'range.bin'); await fs.writeFile(filename,'abcdefghij');
  const [offer] = await receiver.outbox.enqueue(receiver.state.devices[0].id,[filename]);
  const route = base+'/download/'+offer.id;
  const headers = {Authorization:'Bearer '+token};
  assert.equal((await fetch(route,{method:'HEAD',headers})).headers.get('content-length'),'10');
  assert.equal(receiver.outbox.record(offer.id).status,'queued');
  const first = await fetch(route,{headers:{...headers,Range:'bytes=0-3'}});
  assert.equal(first.status,206); assert.equal(first.headers.get('content-range'),'bytes 0-3/10');
  assert.equal(await first.text(),'abcd');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(receiver.outbox.record(offer.id).status,'queued');
  const rest = await fetch(route,{headers:{...headers,Range:'bytes=4-'}}); assert.equal(await rest.text(),'efghij');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(receiver.outbox.record(offer.id).status,'sent');
  const suffix = await fetch(route,{headers:{...headers,Range:'bytes=-2'}}); assert.equal(await suffix.text(),'ij');
  assert.equal((await fetch(route,{headers:{...headers,Range:'bytes=100-200'}})).status,416);
});
test('preview is restricted to safe media types and is separate from download completion', async () => {
  token = await pair();
  const photo = path.join(root,'photo.jpg'), html = path.join(root,'page.html'), empty = path.join(root,'empty.txt');
  await fs.writeFile(photo,Buffer.from([0xff,0xd8,0xff,0xd9])); await fs.writeFile(html,'<script>alert(1)</script>'); await fs.writeFile(empty,'');
  const offers = await receiver.outbox.enqueue(receiver.state.devices[0].id,[photo,html,empty]);
  const headers={Authorization:'Bearer '+token};
  const preview = await fetch(base+'/download/'+offers[0].id+'?preview=1',{headers});
  assert.equal(preview.headers.get('content-type'),'image/jpeg'); await preview.arrayBuffer();
  assert.equal(receiver.outbox.record(offers[0].id).status,'queued');
  assert.equal((await fetch(base+'/download/'+offers[1].id+'?preview=1',{headers})).status,415);
  const content = await fetch(base+'/download/'+offers[1].id,{headers});
  assert.equal(content.headers.get('content-type'),'application/octet-stream'); assert.match(content.headers.get('content-disposition'),/^attachment/); await content.arrayBuffer();
  const zero = await fetch(base+'/download/'+offers[2].id,{headers}); assert.equal((await zero.arrayBuffer()).byteLength,0);
});
test('downloads enforce device ownership, revocation and cancellation without deleting source files', async () => {
  token = await pair('Owner'); const ownerToken=token, owner=receiver.state.devices[0];
  const filename = path.join(root,'private.pdf'); await fs.writeFile(filename,'private');
  const [offer] = await receiver.outbox.enqueue(owner.id,[filename]);
  token = await pair('Other');
  assert.equal((await request('/api/inbox')).data.files.length,0);
  assert.equal((await fetch(base+'/download/'+offer.id,{headers:{Authorization:'Bearer '+token}})).status,404);
  token=ownerToken;
  receiver.outbox.cancel(offer.id);
  assert.equal((await request('/api/inbox')).data.files.length,0);
  assert.equal(await fs.readFile(filename,'utf8'),'private');
  const [again] = await receiver.outbox.enqueue(owner.id,[filename]);
  await receiver.revoke(owner.id);
  assert.equal((await fetch(base+'/download/'+again.id,{headers:{Cookie:'lane_download='+ownerToken}})).status,401);
  assert.equal(receiver.state.outbox.length,0);
});
test('file offers survive restart and reject changed or missing originals', async () => {
  token = await pair();
  const filename = path.join(root,'stable.txt'); await fs.writeFile(filename,'original');
  const [offer] = await receiver.outbox.enqueue(receiver.state.devices[0].id,[filename]);
  await receiver.stop();
  receiver = new Receiver({dataDir:path.join(root,'state'),defaultFolder:'unused',host:'127.0.0.1',port:0});
  await receiver.start(); base=`http://127.0.0.1:${receiver.port}`;
  assert.equal((await request('/api/inbox')).data.files[0].id,offer.id);
  receiver.clearHistory(); assert.equal(receiver.outbox.record(offer.id).status,'queued');
  await fs.writeFile(filename,'changed original');
  assert.equal((await fetch(base+'/download/'+offer.id,{headers:{Authorization:'Bearer '+token}})).status,409);
  await fs.unlink(filename);
  assert.equal((await fetch(base+'/download/'+offer.id,{headers:{Authorization:'Bearer '+token}})).status,404);
});

test('long messages preserve exact Unicode, whitespace and formatting across request chunk boundaries', async () => {
  token = await pair();
  const text = '## A long note 😊\r\n\r\n' + 'Dansk æøå 👨‍👩‍👧‍👦 ❤️ **bold**\n'.repeat(1800) + '  last line  ';
  const body = Buffer.from(JSON.stringify({ text, format:'markdown', clientId:crypto.randomUUID() }));
  const emojiOffset = body.indexOf(Buffer.from('😊')) + 1;
  const data = await new Promise((resolve,reject) => {
    const req = http.request(base + '/api/messages', {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':body.length}}, res => {
      const chunks = []; res.on('data',c=>chunks.push(c)); res.on('end',()=>{assert.equal(res.statusCode,201);resolve(JSON.parse(Buffer.concat(chunks)));});
    });
    req.on('error',reject); req.write(body.subarray(0,emojiOffset)); setTimeout(()=>req.end(body.subarray(emojiOffset)),5);
  });
  assert.equal(data.text,text);
  assert.equal((await request('/api/messages')).data.messages[0].text,text);
  assert.equal(receiver.snapshot().conversations[0].unread,1);
  assert.equal(JSON.stringify(receiver.snapshot()).includes(text),false,'Text is kept out of frequent file-transfer snapshots');
});

test('message delivery, opened receipts, isolation and retries are scoped to a conversation', async () => {
  token = await pair('Owner'); const ownerToken=token, owner=receiver.state.devices[0].id;
  const body = {text:'Hello 😊\nNext line',format:'plain',clientId:crypto.randomUUID()};
  const first = await request('/api/messages',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify(body)})).data.id,first.data.id);
  assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify({...body,text:'changed'})})).status,409);
  const outgoing = receiver.messages.send(owner,'outgoing',{...body,clientId:crypto.randomUUID()});
  assert.equal(outgoing.receivedAt,null);
  const revision = receiver.messages.list(owner).revision;
  assert.equal((await request('/api/messages?revision='+revision)).data.unchanged,true);
  token = await pair('Other');
  assert.equal((await request('/api/messages')).data.messages.length,0);
  await request('/api/messages/ack',{method:'POST',body:JSON.stringify({ids:[outgoing.id],read:true})});
  assert.equal(outgoing.receivedAt,null,'Other devices cannot acknowledge this conversation');
  token = ownerToken;
  await request('/api/messages/ack',{method:'POST',body:JSON.stringify({ids:[outgoing.id,first.data.id],read:false})});
  assert.ok(outgoing.receivedAt); assert.equal(outgoing.readAt,null);
  await request('/api/messages/ack',{method:'POST',body:JSON.stringify({ids:[outgoing.id,first.data.id],read:true})});
  assert.ok(outgoing.readAt);
  assert.equal(receiver.messages.get(owner,first.data.id).readAt,null,'Phone cannot open its own incoming message for the desktop');
  receiver.messages.acknowledge(owner,'incoming',{ids:[first.data.id],read:true});
  assert.equal(receiver.snapshot().conversations.find(c=>c.deviceId===owner).unread,0);
  await receiver.revoke(owner);
  assert.equal((await request('/api/messages')).status,401);
  assert.equal(receiver.messages.data.items.length,0);
});

test('clearing prevents old queues and legacy backups from resurrecting messages across restart', async () => {
  token=await pair('First');const first=receiver.state.devices[0].id;
  await pair('Unrelated');const other=receiver.state.devices[1].id;
  const old={text:'Erase this body',format:'plain',clientId:crypto.randomUUID(),generation:'0'};
  assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify(old)})).status,201);
  const keep=receiver.messages.send(other,'outgoing',{text:'Keep the other conversation',format:'plain',clientId:crypto.randomUUID()});
  const response=await request('/api/messages',{method:'DELETE'});
  assert.equal(response.status,200);assert.notEqual(response.data.generation,'0');
  assert.equal(receiver.messages.list(first).total,0);assert.equal(receiver.messages.get(other,keep.id).text,keep.text);
  assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify(old)})).status,409);
  const legacy={...old,clientId:crypto.randomUUID()};delete legacy.generation;
  assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify(legacy)})).status,409);
  const stored=await fs.readFile(path.join(root,'state','messages.json'),'utf8');assert.ok(!stored.includes(old.text));assert.ok(!stored.includes(old.clientId));
  const generation=response.data.generation;
  assert.equal((await request('/api/device')).data.devices.find(d=>d.id==='computer').generation,generation);
  await receiver.stop();receiver=new Receiver({dataDir:path.join(root,'state'),defaultFolder:path.join(root,'inbox'),host:'127.0.0.1',port:0});await receiver.start();base=`http://127.0.0.1:${receiver.port}`;
  assert.equal(receiver.messages.list(first).generation,generation);
  assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify(old)})).status,409);
  const fresh={text:'A new beginning',format:'plain',clientId:crypto.randomUUID(),generation};
  assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify(fresh)})).status,201);
  assert.equal(receiver.messages.list(first).total,1);
});

test('messages persist queued across restart, paginate and clear independently of file history', async () => {
  token = await pair(); const deviceId=receiver.state.devices[0].id;
  const outgoing = receiver.messages.send(deviceId,'outgoing',{text:'Saved offline',format:'plain',clientId:crypto.randomUUID()});
  await receiver.stop();
  receiver = new Receiver({dataDir:path.join(root,'state'),defaultFolder:'unused',host:'127.0.0.1',port:0});
  await receiver.start(); base=`http://127.0.0.1:${receiver.port}`;
  assert.equal(receiver.messages.get(deviceId,outgoing.id).receivedAt,null);
  for (let i=0;i<55;i++) receiver.messages.send(deviceId,'incoming',{text:'Note '+i,format:'plain',clientId:crypto.randomUUID()});
  const page = (await request('/api/messages')).data;
  assert.equal(page.total,56); assert.equal(page.messages.length,50);
  assert.equal((await request('/api/messages?limit=100')).data.messages.length,56);
  receiver.clearHistory(); assert.equal(receiver.messages.list(deviceId).total,56);
  receiver.messages.clear(deviceId); assert.equal(receiver.messages.list(deviceId).total,0);
});

test('message validation, capacity bounds and bearer-only authorization', async () => {
  token = await pair();
  const body = {text:'Valid',format:'plain',clientId:crypto.randomUUID()};
  for (const patch of [{text:''},{text:' '.repeat(10)},{text:'x'.repeat(100001)},{text:99},{format:'html'},{clientId:'bad'},{clientId:[crypto.randomUUID()]}]) {
    assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify({...body,...patch})})).status,400);
  }
  for (const data of ['null','[]','"text"','{']) assert.equal((await request('/api/messages',{method:'POST',body:data})).status,400);
  assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify({...body,text:'x'.repeat(660000)})})).status,413);
  assert.equal((await request('/api/messages/ack',{method:'POST',body:JSON.stringify({ids:'bad',read:true})})).status,400);
  assert.equal((await fetch(base+'/api/messages',{headers:{Cookie:'lane_download='+token}})).status,401);
  const id=receiver.state.devices[0].id;
  receiver.messages.data.items = Array.from({length:1000},(_,i)=>({id:String(i),deviceId:id,senderId:id,recipientId:'computer',text:'Stored note'}));
  assert.equal((await request('/api/messages',{method:'POST',body:JSON.stringify(body)})).status,507);
});

test('formatted notes escape active content and preserve plain text and emojis', async () => {
  const text='## Note 😊\n**Bold** and *italic* with `code`\n- First\n> Quoted\n<script>alert(1)</script>\n![x](https://example.com/a)\n<img src=x onerror=alert(1)>\n```html\n<b>literal</b>\n```';
  const html = messageFormat.html(text,'markdown');
  assert.match(html,/<h4>Note 😊<\/h4>/); assert.match(html,/<strong>Bold<\/strong>/);
  assert.ok(!/<script|<img|<a\b|onerror="/.test(html)); assert.match(html,/&lt;script&gt;/);
  assert.match(messageFormat.plain(text,'markdown'),/Note 😊\nBold and italic with code/);
  const plain='  <hello> & 😊\r\nline 2\n';
  assert.equal(messageFormat.plain(plain,'plain'),plain);
  for (const asset of ['/chat.js','/chat.css','/message-format.js']) assert.equal((await fetch(base+asset)).status,200);
});

test('paired devices have a private directory and can exchange direct messages concurrently', async () => {
  const a=await pair('Phone A'),b=await pair('Phone B'),c=await pair('Phone C');
  const [da,db,dc]=receiver.state.devices;
  const call=(auth,route,options={})=>request(route,{...options,headers:{Authorization:'Bearer '+auth}});
  const directory=(await call(a,'/api/device')).data;
  assert.equal(directory.devices.length,3); assert.ok(directory.devices.some(d=>d.id===db.id));
  assert.ok(!JSON.stringify(directory).includes('tokenHash'));
  const bodies=Array.from({length:24},(_,i)=>({text:'Peer note '+i,format:'plain',clientId:crypto.randomUUID(),recipientId:i%2 ? da.id : db.id}));
  const sent=await Promise.all(bodies.map((body,i)=>call(i%2 ? b : a,'/api/messages',{method:'POST',body:JSON.stringify(body)})));
  assert.ok(sent.every(r=>r.status===201));
  const conversation=(await call(b,'/api/messages?peer='+da.id)).data.messages;
  assert.equal(conversation.length,24);
  assert.equal(receiver.messages.list(da.id).total,0,'Peer conversations do not appear in the computer’s own chat');
  assert.equal((await call(c,'/api/messages?peer='+da.id)).data.messages.length,0);
  const incoming=conversation.find(m=>m.recipientId===db.id);
  await call(c,'/api/messages/ack',{method:'POST',body:JSON.stringify({ids:[incoming.id],read:true})});
  assert.equal(receiver.messages.data.items.find(m=>m.id===incoming.id).readAt,null);
  await call(b,'/api/messages/ack',{method:'POST',body:JSON.stringify({ids:[incoming.id],read:false})});
  assert.ok(receiver.messages.data.items.find(m=>m.id===incoming.id).receivedAt);
  assert.equal(receiver.messages.data.items.find(m=>m.id===incoming.id).readAt,null);
  await call(b,'/api/messages/ack',{method:'POST',body:JSON.stringify({ids:[incoming.id],read:true})});
  assert.ok(receiver.messages.data.items.find(m=>m.id===incoming.id).readAt);
  assert.equal((await call(a,'/api/messages',{method:'POST',body:JSON.stringify({...bodies[0],clientId:crypto.randomUUID(),recipientId:da.id})})).status,400);
  assert.equal((await call(c,'/api/messages?peer='+da.id,{method:'DELETE'})).status,200);
  assert.equal(receiver.messages.listFor(da.id,db.id).total,24);
});

test('reactions toggle per participant, persist, and reject third parties or active HTML', async () => {
  const a=await pair('A'),b=await pair('B'),c=await pair('C'); const [da,db]=receiver.state.devices;
  const m=receiver.messages.send(da.id,'incoming',{text:'React 😊',format:'plain',clientId:crypto.randomUUID(),recipientId:db.id});
  const react=(auth,emoji)=>request(`/api/messages/${m.id}/reaction`,{method:'POST',headers:{Authorization:'Bearer '+auth},body:JSON.stringify({emoji})});
  assert.equal((await react(c,'❤️')).status,404);
  assert.equal((await react(a,'<img src=x>')).status,400);
  assert.equal((await react(a,'❤️')).status,200); assert.equal((await react(b,'❤️')).status,200);
  assert.equal(m.reactions.length,2);
  await react(a,'😊'); assert.equal(m.reactions.filter(r=>r.actorId===da.id).length,1);
  await react(a,null); assert.equal(m.reactions.length,1);
  await receiver.stop(); receiver=new Receiver({dataDir:path.join(root,'state'),defaultFolder:'unused',host:'127.0.0.1',port:0}); await receiver.start();base=`http://127.0.0.1:${receiver.port}`;
  assert.equal(receiver.messages.listFor(da.id,db.id).messages[0].reactions[0].emoji,'❤️');
  await receiver.revoke(db.id); assert.equal(receiver.messages.data.items.length,0);
});

test('phone-to-phone files relay through the computer with recipient-scoped downloads and stable retries', async () => {
  const a=await pair('Sender'),b=await pair('Recipient'),c=await pair('Other');const [da,db]=receiver.state.devices;
  token=a;
  const payload=Buffer.from('Local peer file 📄\nPDF, video or any exact bytes\0\xff');
  const created=await request('/api/uploads',{method:'POST',body:JSON.stringify({name:'Peer file.pdf',size:payload.length,clientId:crypto.randomUUID(),recipientId:db.id})});
  assert.equal(created.status,201);
  await request('/api/uploads/'+created.data.id,{method:'PUT',headers:{'X-File-Offset':'0'},body:payload});
  const complete=await request('/api/uploads/'+created.data.id+'/complete',{method:'POST'});
  assert.equal(complete.status,200);assert.ok(complete.data.relayOfferId);
  const again=await request('/api/uploads/'+created.data.id+'/complete',{method:'POST'});
  assert.equal(again.data.relayOfferId,complete.data.relayOfferId);assert.equal(receiver.state.outbox.length,1);
  assert.deepEqual(await fs.readFile(path.join(root,'inbox','Peer file.pdf')),payload);
  assert.equal((await request('/api/device')).data.sent[0].status,'ready');
  const offer=receiver.outbox.list(db.id)[0];assert.equal(offer.senderName,'Sender');
  assert.equal((await fetch(base+'/download/'+offer.id,{headers:{Authorization:'Bearer '+c}})).status,404);
  const response=await fetch(base+'/download/'+offer.id,{headers:{Authorization:'Bearer '+b}});assert.deepEqual(Buffer.from(await response.arrayBuffer()),payload);
  assert.equal((await request('/api/device')).data.sent[0].status,'downloaded');
  await receiver.revoke(da.id);assert.equal(receiver.state.outbox.length,0);
  assert.deepEqual(await fs.readFile(path.join(root,'inbox','Peer file.pdf')),payload,'Revocation preserves the saved original');
});

test('recipient revocation cancels an in-flight relay, and profile and theme settings are validated', async () => {
  token=await pair('My iPhone');const owner=receiver.state.devices[0]; await pair('My iPhone');const recipient=receiver.state.devices[1];
  assert.equal(recipient.name,'My iPhone (2)');
  const upload=await request('/api/uploads',{method:'POST',body:JSON.stringify({name:'Waiting.bin',size:50,clientId:crypto.randomUUID(),recipientId:recipient.id})});
  assert.equal(upload.status,201);
  await receiver.revoke(recipient.id);assert.equal(receiver.jobs.size,0);
  assert.equal(receiver.state.history.find(h=>h.id===upload.data.id).status,'cancelled');
  assert.equal((await request('/api/device',{method:'PATCH',body:JSON.stringify({name:'Test phone 😊'})})).status,200);
  assert.equal(owner.name,'Test phone 😊');
  assert.equal((await request('/api/device',{method:'PATCH',body:JSON.stringify({name:''})})).status,400);
  await receiver.updateSettings({theme:'dark'});assert.equal(receiver.snapshot().settings.theme,'dark');
  await receiver.updateSettings({theme:'invalid'});assert.equal(receiver.snapshot().settings.theme,'dark');
  for(const asset of ['/theme.css','/theme.js'])assert.equal((await fetch(base+asset)).status,200);
});

test('version 0.3 message history migrates without losing content or receipts', async () => {
  token=await pair();const id=receiver.state.devices[0].id;
  await receiver.stop();
  await fs.writeFile(path.join(root,'state','messages.json'),JSON.stringify({revision:3,sequence:1,items:[{id:crypto.randomUUID(),seq:1,deviceId:id,direction:'incoming',text:'An existing note ❤️',format:'plain',clientId:crypto.randomUUID(),created:1,receivedAt:2,readAt:3}]}));
  receiver=new Receiver({dataDir:path.join(root,'state'),defaultFolder:'unused',host:'127.0.0.1',port:0});await receiver.start();base=`http://127.0.0.1:${receiver.port}`;
  const m=receiver.messages.list(id).messages[0];assert.equal(m.text,'An existing note ❤️');assert.equal(m.senderId,id);assert.equal(m.recipientId,'computer');assert.equal(m.readAt,3);
  assert.equal(receiver.messages.listFor(id,'computer').messages[0].direction,'outgoing');
});
