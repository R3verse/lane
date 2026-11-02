const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TransferWakeLock}=require('../src/mobile/web-app.js');
function fixture(request){
  const document=new EventTarget();document.hidden=false;
  const states=[],navigator={wakeLock:{request}};
  const wake=new TransferWakeLock({document,navigator,secure:true,onChange:state=>states.push(state)});
  return {wake,document,states};
}
function lock(){const value=new EventTarget();value.released=false;value.release=async()=>{value.released=true;value.dispatchEvent(new Event('release'));};return value;}
test('wake lock is held only for active visible uploads and released on completion',async()=>{
  let requested=0;const held=lock();const {wake}=fixture(async kind=>{assert.equal(kind,'screen');requested++;return held;});
  await wake.sync();assert.equal(requested,0);await wake.setActive(true);assert.equal(wake.state,'held');
  await wake.setActive(true);assert.equal(requested,1);await wake.setActive(false);assert.equal(held.released,true);assert.equal(wake.state,'idle');await wake.close();
});
test('a late grant is released when an upload was cancelled while permission was pending',async()=>{
  let grant;const held=lock();const {wake}=fixture(()=>new Promise(resolve=>grant=resolve));
  const pending=wake.setActive(true);await wake.setActive(false);grant(held);await pending;
  assert.equal(held.released,true);assert.equal(wake.lock,null);assert.equal(wake.state,'idle');await wake.close();
});
test('hidden pages release wake locks; visible transfers can reacquire and opt-out releases',async()=>{
  const locks=[];const {wake,document}=fixture(async()=>{const held=lock();locks.push(held);return held;});
  await wake.setActive(true);document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));await wake.sync();assert.equal(locks[0].released,true);
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await wake.sync();assert.equal(locks.length,2);assert.equal(wake.state,'held');
  await wake.setEnabled(false);assert.equal(locks[1].released,true);assert.equal(wake.state,'off');await wake.close();
});
test('unsupported and denied wake lock report limits without blocking uploads; retry recovers',async()=>{
  let reject=true;const {wake}=fixture(()=>{if(reject)throw new Error('Battery saver');return Promise.resolve(lock());});
  await wake.setActive(true);assert.equal(wake.state,'denied');assert.equal(wake.pending,null);
  reject=false;await wake.sync();assert.equal(wake.state,'held');await wake.close();
  const unsupported=new TransferWakeLock({navigator:{},document:new EventTarget(),secure:false});await unsupported.setActive(true);assert.equal(unsupported.state,'unsupported');await unsupported.close();
});
