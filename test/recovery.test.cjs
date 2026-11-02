const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
function browser(storage=new Map()){
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,console,btoa,atob,setTimeout,clearTimeout,crypto:{getRandomValues:a=>crypto.getRandomValues(a)},localStorage:{get length(){return storage.size;},key:i=>[...storage.keys()][i],getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
  vm.runInContext('window=globalThis',context);
  for(const f of ['crypto-vendor.js','crypto-identity.js','recovery.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/shared',f),'utf8'),context);
  return context;
}
test('encrypted recovery preserves identities and Unicode drafts across origins and rejects wrong passwords, scope and tampering',async()=>{
  const storage=new Map(),a=browser(storage),identity=await a.LaneCrypto.identity('phone:scope');
  storage.set('lane:scope','paired-credential');storage.set('lane-chat:scope:device',JSON.stringify({draft:'A long note 😊 漢字',pending:[]}));storage.set('lane:another','unrelated');
  const password='correct horse battery staple',packed=await a.LaneRecovery.pack('scope','phone',password);
  for(const secret of ['paired-credential',identity.privateKey.d,'A long note','unrelated'])assert.ok(!packed.includes(secret));
  const otherStorage=new Map(),b=browser(otherStorage),saved=await b.LaneRecovery.unpack(packed,'scope','phone',password);b.LaneRecovery.restore(saved);
  assert.equal((await b.LaneCrypto.identity('phone:scope')).privateKey.d,identity.privateKey.d);assert.equal(otherStorage.get('lane-chat:scope:device'),storage.get('lane-chat:scope:device'));assert.ok(!otherStorage.has('lane:another'));
  await assert.rejects(b.LaneRecovery.unpack(packed,'scope','phone','wrong password'),/Incorrect password/);
  await assert.rejects(b.LaneRecovery.unpack(packed,'other','phone',password),/different Lane/);
  await assert.rejects(b.LaneRecovery.unpack(packed,'scope','computer',password),/different Lane/);
  const bad=JSON.parse(packed);bad.ciphertext='AAAA'+bad.ciphertext.slice(4);await assert.rejects(b.LaneRecovery.unpack(JSON.stringify(bad),'scope','phone',password),/damaged backup/);
  bad.rounds=2;await assert.rejects(b.LaneRecovery.unpack(JSON.stringify(bad),'scope','phone',password),/Unsupported/);
  await assert.rejects(a.LaneRecovery.pack('scope','phone','short'),/12/);
});
