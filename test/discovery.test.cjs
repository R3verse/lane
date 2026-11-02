const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Discovery,entry}=require('../src/discovery.cjs');
const {launchRequest}=require('../src/windows-actions.cjs');
const service={txt:{id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',name:'Nearby computer',protocol:'lane-1'},addresses:['8.8.8.8','192.168.1.7'],port:47831};
test('discovery accepts local Lane records without treating advertisements as pairing',()=>{
  assert.equal(entry(service,'self').url,'http://192.168.1.7:47831');
  assert.equal(entry(service,service.txt.id),null);
  for(const patch of [{addresses:['8.8.8.8']},{addresses:['192.168.not.an.ip']},{port:70000},{txt:{id:'bad'}},{addresses:['127.0.0.1']}])assert.equal(entry({...service,...patch},'self'),null);
  let destroyed=0,published;
  const browse=new EventEmitter(),advertisement=new EventEmitter();browse.stop=()=>{};browse.update=()=>{};advertisement.stop=()=>{};
  const receiver={port:47831,state:{receiverId:'own-id',settings:{nearbyDiscovery:true,computerName:'Desk'}},changed:()=>{}};
  const discovery=new Discovery(receiver,()=>({publish:options=>{published=options;return advertisement;},find:()=>browse,destroy:()=>destroyed++}));
  discovery.start();browse.emit('up',service);
  assert.equal(discovery.snapshot().computers.length,1);assert.ok(!JSON.stringify(published).includes('token'));
  browse.emit('down',service);assert.equal(discovery.snapshot().computers.length,0);
  discovery.stop();assert.equal(destroyed,1);assert.equal(discovery.status,'off');
});
test('Windows launch requests preserve file paths and only accept supported actions',()=>{
  assert.deepEqual(launchRequest(['Lane.exe','--lane-send','C:\\My notes\\hello.md','C:\\Photos\\one.jpg']),{action:'send',files:['C:\\My notes\\hello.md','C:\\Photos\\one.jpg']});
  assert.deepEqual(launchRequest(['Lane.exe','--lane-action=messages']),{action:'messages'});
  assert.equal(launchRequest(['Lane.exe','--lane-action=delete']),null);
  assert.equal(launchRequest(['Lane.exe','--lane-send','--bad','relative.txt']),null);
});
