const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sanitize}=require('../src/shared/connection-check.js');
test('diagnostic report allowlist excludes private data and rejects arbitrary values',()=>{
  const report=sanitize({client:'Browser',version:'0.10.0',reachable:true,https:false,latencyMs:42.6,token:'secret',address:'192.168.1.2',name:'Private person',messages:['private'],folder:'C:\\private',paired:{token:'secret'},receiving:'private reason'});
  assert.deepEqual(report,{client:'Browser',version:'0.10.0',reachable:true,https:false,latencyMs:43});
  assert.deepEqual(sanitize({client:'private',version:'0.10.0 + private',latencyMs:Infinity}),{});
});
