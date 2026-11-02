const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('esbuild').buildSync({ entryPoints:[path.join(__dirname,'crypto-vendor.mjs')], bundle:true, minify:true, format:'iife', platform:'browser', target:['safari15'], outfile:path.join(root,'src/shared/crypto-vendor.js'), legalComments:'inline' });
// Locally generated two-note PCM chime. No media service or network dependency.
const rate = 24000, count = Math.round(rate * .45), wav = Buffer.alloc(44 + count * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(count*2,40);
for (let i=0;i<count;i++) { const t=i/rate, segment=t < .18 ? t : t-.18, frequency=t < .18 ? 740 : 988; const envelope=Math.min(segment/.008,1)*Math.exp(-segment*14); wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*frequency*segment)*envelope*18000),44+i*2); }
fs.writeFileSync(path.join(root,'src/shared/message-tone.wav'),wav);
const licenses = ['@noble/curves','@noble/ciphers','@noble/hashes'].map(name=>name+'\n'+fs.readFileSync(path.join(root,'node_modules',name,'LICENSE'),'utf8'));
fs.writeFileSync(path.join(root,'src/shared/CRYPTO-LICENSES.txt'),licenses.join('\n\n'));
