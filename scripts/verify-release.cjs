const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const archive=path.join(root,'release','win-unpacked','resources','app.asar');
let count=0;
function check(directory){for(const item of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())check(file);else{assert.deepEqual(asar.extractFile(archive,file),fs.readFileSync(path.join(root,file)),file);count++;}}}
check('src');check('assets');
assert.equal(JSON.parse(asar.extractFile(archive,'package.json').toString()).version,version);
const artifacts=['Setup','Portable'].map(kind=>{
  const name=`Lane-${kind}-${version}.exe`,file=path.join(root,'release',name),bytes=fs.readFileSync(file);
  return {name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
});
fs.writeFileSync(path.join(root,'release',`SHA256SUMS-${version}.txt`),artifacts.map(f=>`${f.sha256}  ${f.name}`).join('\n')+'\n');
console.log(JSON.stringify({passed:true,matchedAssets:count,version,artifacts},null,2));
