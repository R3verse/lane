const {Discovery}=require('../src/discovery.cjs');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const receivers=[1,2].map(n=>({port:47831+n,state:{receiverId:crypto.randomUUID(),settings:{computerName:'Lane discovery test '+n,nearbyDiscovery:true}},changed:()=>{}}));
const instances=receivers.map(r=>new Discovery(r));
async function main(){
  try {
    for(const instance of instances)instance.start();
    const started=Date.now();
    while(Date.now()-started<20000){if(instances.every((d,i)=>d.snapshot().computers.some(p=>p.id===receivers[1-i].state.receiverId)))break;await new Promise(r=>setTimeout(r,250));}
    for(const [i,d]of instances.entries())assert.ok(d.snapshot().computers.some(p=>p.id===receivers[1-i].state.receiverId),'Both receivers discover each other over real mDNS multicast');
    console.log('PASS: both local receivers discovered each other using Bonjour multicast.');
  } finally { for(const instance of instances)instance.stop(); }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
