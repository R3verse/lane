const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {Receiver}=require('../src/server.cjs');
function browser(storage=new Map()) {
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,console,btoa,atob,crypto:{getRandomValues:array=>crypto.getRandomValues(array)},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}});
  for(const file of ['crypto-vendor.js','crypto-identity.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/shared',file),'utf8'),context);
  return context.LaneCrypto;
}
test('LAN HTTP crypto preserves maximum Unicode notes, interoperates with Node and rejects tampering',async()=>{
  const a=browser(),b=browser(),alice=await a.identity('a'),bob=await b.identity('b');
  const ctx={scope:'server',viewerId:'alice',peerId:'bob'},back={scope:'server',viewerId:'bob',peerId:'alice'};
  const body={text:'漢'.repeat(99990)+'😊 notes!',clientId:crypto.randomUUID(),format:'markdown'};
  const envelope=await a.encrypt(body,alice,bob.publicKey,ctx),message={...envelope,clientId:body.clientId,format:body.format,senderId:'alice',recipientId:'bob',senderPublicKey:alice.publicKey};
  assert.equal((await b.decrypt(message,bob,alice.publicKey,back)).text,body.text);
  assert.equal((await a.decrypt(message,alice,bob.publicKey,ctx)).text,body.text);
  assert.equal(a.fingerprint(alice.publicKey,bob.publicKey),b.fingerprint(bob.publicKey,alice.publicKey));
  const shared=crypto.diffieHellman({privateKey:crypto.createPrivateKey({key:alice.privateKey,format:'jwk'}),publicKey:crypto.createPublicKey({key:bob.publicKey,format:'jwk'})});
  const canonical=k=>Buffer.concat([Buffer.from([4]),Buffer.from(k.x,'base64url'),Buffer.from(k.y,'base64url')]).toString('base64');
  const key=crypto.hkdfSync('sha256',shared,'Lane E2EE v2',[canonical(alice.publicKey),canonical(bob.publicKey)].sort().join('|'),32);
  const cipher=Buffer.from(message.text,'base64'),decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(message.iv,'base64'));
  decipher.setAAD(Buffer.from(JSON.stringify(['lane-message-v2','alice','bob',body.clientId,'markdown'])));decipher.setAuthTag(cipher.subarray(-16));
  assert.equal(Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]).toString(),body.text);
  for(const patch of [{text:'A'+message.text.slice(1)},{format:'plain'},{clientId:crypto.randomUUID()},{recipientId:'mallory'},{iv:'AAAAAAAAAAAAAAAA'}])assert.equal((await b.decrypt({...message,...patch},bob,alice.publicKey,back)).decryptionFailed,true);
  const mallory=await a.identity('mallory');
  await assert.rejects(a.encrypt(body,alice,mallory.publicKey,ctx),/key changed/);
  await assert.rejects(a.encrypt(body,alice,null,ctx),/Encryption is not ready/);
});
test('identity survives reload and storage loss is not silently ignored',async()=>{
  const storage=new Map(),a=browser(storage),key=await a.identity('persist');
  assert.equal((await browser(storage).identity('persist')).privateKey.d,key.privateKey.d);
  storage.set('lane-e2ee:persist','broken');
  await assert.rejects(browser(storage).identity('persist'));
});
test('relay stores ciphertext, enforces registered keys and downgrade protection, and deduplicates retry envelopes',async()=>{
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'lane-e2ee-')),receiver=new Receiver({dataDir:dir,defaultFolder:path.join(dir,'files'),host:'127.0.0.1',port:0});
  try {
    const client=browser(),desk=await client.identity('desk'),phone=await client.identity('phone');receiver.updateIdentityPublicKey(desk.publicKey);
    receiver.state.devices.push({id:'phone',name:'Phone',publicKey:phone.publicKey});
    const body={text:'Private note 😊',format:'plain',clientId:crypto.randomUUID()};
    const envelope=await client.encrypt(body,phone,desk.publicKey,{scope:'server',viewerId:'phone',peerId:'computer'});
    const sent=receiver.messages.send('phone','incoming',{...body,...envelope});
    assert.equal(receiver.messages.send('phone','incoming',{...body,...envelope}).id,sent.id);
    assert.equal(receiver.messages.data.items.length,1);
    assert.ok(!fs.readFileSync(path.join(dir,'messages.json'),'utf8').includes(body.text));
    assert.throws(()=>receiver.messages.send('phone','incoming',{...body,clientId:crypto.randomUUID()}),/Encrypted messages are required/);
    assert.throws(()=>receiver.messages.send('phone','incoming',{...body,...envelope,publicKey:desk.publicKey}),/not registered/);
    assert.throws(()=>receiver.messages.send('phone','incoming',{...body,...envelope,iv:'AAAAAAAAAAAAAAAA'}),/already in use/);
    assert.throws(()=>receiver.updateIdentityPublicKey(phone.publicKey),/key changed/);
    assert.throws(()=>receiver.updateIdentityPublicKey(desk.privateKey),/Invalid encryption key/);
    const long={text:'漢'.repeat(100000),format:'plain',clientId:crypto.randomUUID()};
    const sealed=await client.encrypt(long,phone,desk.publicKey,{scope:'server',viewerId:'phone',peerId:'computer'});
    assert.ok(receiver.messages.send('phone','incoming',{...long,...sealed}).encrypted);
    const loaded=new Receiver({dataDir:dir,defaultFolder:path.join(dir,'files'),host:'127.0.0.1',port:0});
    assert.equal(loaded.messages.data.items.length,2);
    assert.equal((await client.decrypt(loaded.messages.data.items[0],desk,phone.publicKey,{scope:'server',viewerId:'computer',peerId:'phone'})).text,body.text);
  } finally { await receiver.stop();assert.ok(path.basename(dir).startsWith('lane-e2ee-'));await fsp.rm(dir,{recursive:true,force:true}); }
});
