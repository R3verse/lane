const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../src/shared/sound.js'),'utf8');
function harness(){
  let gesture=false,mode='normal',started=0,closed=0;const contexts=[],timers=new Set();
  const node=()=>({connect(){},disconnect(){}});
  class AudioContext{
    constructor(){this.state='suspended';this.currentTime=0;this.destination={};contexts.push(this);}
    resume(){
      if(!gesture)return Promise.reject(new Error('NotAllowedError: user gesture required'));
      if(mode==='interrupted')return new Promise(()=>{});
      return Promise.resolve().then(()=>{this.state='running';});
    }
    close(){this.state='closed';closed++;return Promise.resolve();}
    createOscillator(){return {...node(),frequency:{value:0},start(){started++;},stop(){}};}
    createGain(){return {...node(),gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}};}
  }
  const sandbox={window:{AudioContext},navigator:{},document:{addEventListener(){}},setTimeout:fn=>{timers.add(fn);return fn;},clearTimeout:fn=>timers.delete(fn)};
  vm.runInNewContext(script,sandbox);
  return {sound:sandbox.LaneSound,contexts,get started(){return started;},get closed(){return closed;},tap(fn){gesture=true;const result=fn();gesture=false;return result;},interrupt(){mode='interrupted';},recover(){mode='normal';},timeout(){for(const fn of [...timers])fn();}};
}
test('sound resumes in the initiating tap before asynchronous work loses user activation',async()=>{
  const h=harness();assert.equal(await h.tap(()=>h.sound.play()),true);assert.equal(h.started,2);
  assert.equal(await h.sound.play(),true,'An activated context plays subsequent incoming alerts');
  assert.equal(h.started,4);
});
test('sound reports rejection truthfully and recovers on a later gesture',async()=>{
  const h=harness();assert.equal(await h.sound.play(),false);assert.match(h.sound.status().error,/user gesture/);assert.equal(h.started,0);
  assert.equal(await h.tap(()=>h.sound.play()),true);assert.equal(h.sound.status().error,'');
});
test('an interrupted audio resume times out and Reset creates a working context in the same tap',async()=>{
  const h=harness();h.interrupt();const waiting=h.tap(()=>h.sound.play());h.timeout();assert.equal(await waiting,false);assert.match(h.sound.status().error,/Reset audio/);
  h.recover();assert.equal(await h.tap(()=>h.sound.reset()),true);assert.equal(h.closed,1);assert.equal(h.contexts.length,2);
});
