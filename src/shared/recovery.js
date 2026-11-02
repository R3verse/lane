(function(){
  'use strict';
  const {gcm,sha256,pbkdf2Async,p256}=window.LanePrimitives;
  const encode=new TextEncoder(),decode=new TextDecoder('utf-8',{fatal:true});
  const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
  const un64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const MAX=12*1024*1024,rounds=600000,aad=encode.encode('Lane recovery v1');
  const allowed=(key,scope,kind)=>key===`lane-e2ee:${kind}:${scope}` || kind==='phone' && key==='lane:'+scope || key.startsWith('lane-peer-key:'+scope+':') || key.startsWith('lane-chat:'+scope+':');
  async function pack(scope,kind,password) {
    if(password.length<12 || password.length>1024)throw new Error('Use a password of 12–1,024 characters.');
    const entries={};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(allowed(key,scope,kind))entries[key]=localStorage.getItem(key);}
    if(!entries[`lane-e2ee:${kind}:${scope}`])throw new Error('No encryption identity is available to back up.');
    const plain=encode.encode(JSON.stringify({scope,kind,entries,created:Date.now()}));
    if(plain.length>8*1024*1024)throw new Error('The backup is too large. Send or remove queued messages first.');
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await pbkdf2Async(sha256,encode.encode(password),salt,{c:rounds,dkLen:32});
    try{return JSON.stringify({type:'lane-recovery',version:1,kdf:'PBKDF2-SHA256',rounds,salt:b64(salt),iv:b64(iv),ciphertext:b64(gcm(key,iv,aad).encrypt(plain))});}finally{key.fill(0);plain.fill(0);}
  }
  async function unpack(text,scope,kind,password) {
    if(text.length>MAX || password.length>1024)throw new Error('Backup is too large.');
    let data;try{data=JSON.parse(text);}catch{throw new Error('Choose a Lane recovery file.');}
    if(data.type!=='lane-recovery' || data.version!==1 || data.rounds!==rounds || data.kdf!=='PBKDF2-SHA256' || typeof data.ciphertext!=='string')throw new Error('Unsupported recovery file.');
    const salt=un64(data.salt),iv=un64(data.iv);if(salt.length!==16 || iv.length!==12)throw new Error('Invalid recovery file.');
    const key=await pbkdf2Async(sha256,encode.encode(password),salt,{c:rounds,dkLen:32});
    let saved;try{saved=JSON.parse(decode.decode(gcm(key,iv,aad).decrypt(un64(data.ciphertext))));}catch{throw new Error('Incorrect password or damaged backup. Nothing was changed.');}finally{key.fill(0);}
    if(saved.scope!==scope || saved.kind!==kind)throw new Error('This backup belongs to a different Lane computer or client type.');
    if(!saved.entries || Object.keys(saved.entries).length>10000)throw new Error('Invalid backup contents.');
    for(const [k,v] of Object.entries(saved.entries))if(!allowed(k,scope,kind) || typeof v!=='string')throw new Error('Unexpected backup entry.');
    const identity=JSON.parse(saved.entries[`lane-e2ee:${kind}:${scope}`] || 'null');
    if(!identity?.privateKey?.d || b64(p256.getPublicKey(un64(identity.privateKey.d),false))!==b64(Uint8Array.from([4,...un64(identity.publicKey.x),...un64(identity.publicKey.y)])))throw new Error('The backup encryption key is invalid.');
    return saved;
  }
  function restore(saved) {
    const before=new Map(Object.keys(saved.entries).map(k=>[k,localStorage.getItem(k)]));
    try { for(const [k,v] of Object.entries(saved.entries)) localStorage.setItem(k,v); }
    catch(err){for(const [k,v]of before){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}throw new Error('Browser storage is full. Nothing was restored.');}
  }
  function dialog(info,kind,mode) {
    const element=document.createElement('dialog');element.className='discover-dialog recovery-dialog';element.setAttribute('aria-label',mode==='save' ? 'Save encrypted backup' : 'Restore encrypted backup');
    element.innerHTML=`<button class="discover-close" type="button" aria-label="Close">×</button><span class="eyebrow">YOUR MESSAGE IDENTITY</span><h2>${mode==='save' ? 'Keep your keys safe.' : 'Bring your identity back.'}</h2><p>${mode==='save' ? 'This encrypted file contains your message keys, pairing credential, drafts and queued text for this Lane computer. Received messages and files remain on the computer. Store the backup and its password safely.' : 'Choose a backup from this device’s previous Lane page. Restoring replaces matching local keys, drafts and queued text. Save a current backup first if needed. The computer must still retain the pairing and message history.'}</p><form>${mode==='restore' ? '<label>Recovery file<input type="file" accept=".lane-backup,application/json" required></label>' : ''}<label>Password<input type="password" minlength="12" maxlength="1024" autocomplete="off" required></label>${mode==='save' ? '<label>Confirm password<input class="confirm-password" type="password" minlength="12" maxlength="1024" autocomplete="off" required></label>' : ''}<button class="primary" type="submit">${mode==='save' ? 'Save encrypted backup' : 'Restore this backup'}</button><p class="recovery-status" role="status"></p></form>`;
    document.body.append(element);element.querySelector('.discover-close').onclick=()=>element.close();element.addEventListener('close',()=>element.remove());
    element.querySelector('form').addEventListener('submit',async event=>{
      event.preventDefault();const button=element.querySelector('[type=submit]'),status=element.querySelector('.recovery-status'),password=element.querySelector('[type=password]').value;button.disabled=true;status.textContent='Working locally…';
      try {
        if(mode==='save') {
          if(password!==element.querySelector('.confirm-password').value)throw new Error('The passwords do not match.');
          const data=await pack(info.receiverId,kind,password);
          if(kind==='computer'){if(!await window.lane.saveRecovery(data)){status.textContent='Save cancelled.';return;}}
          else {const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='Lane-identity.lane-backup';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
          status.textContent='Backup saved to your download or chosen folder. Keep its password separately. Lane cannot reset it.';
        } else {
          const file=element.querySelector('[type=file]').files[0];if(!file || file.size>MAX)throw new Error('Choose a Lane recovery file smaller than 12 MB.');
          const saved=await unpack(await file.text(),info.receiverId,kind,password);
          const identity=JSON.parse(saved.entries[`lane-e2ee:${kind}:${info.receiverId}`]);
          if(kind==='phone') {
            const token=saved.entries['lane:'+info.receiverId];if(!token)throw new Error('This backup has no pairing. Pair this browser first.');
            const response=await fetch('/api/device',{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw new Error('The original pairing is no longer available. Restore the computer’s data or pair again.');
            const remote=await response.json();if(!window.LaneCrypto.sameKey(identity.publicKey,remote.publicKey))throw new Error('The backup does not match the paired device’s key.');
          } else if(!window.LaneCrypto.sameKey(identity.publicKey,info.computerPublicKey))throw new Error('This backup does not match this computer’s registered key.');
          restore(saved);location.reload();
        }
      }catch(err){status.textContent=err.message;}finally{button.disabled=false;}
    });element.showModal();
  }
  function mountMobile(info) {
    if(document.querySelector('#mobile-recovery'))return;
    const root=document.createElement('section');root.className='mobile-settings';root.id='mobile-recovery';
    root.innerHTML='<h2>Recovery & HTTPS</h2><p>Save your message identity before changing browser addresses or clearing site data. Restore the backup at the HTTPS address to keep your pairing and message keys.</p><div class="recovery-actions"><button data-recovery="save">Save encrypted backup</button><button data-recovery="restore">Restore backup</button></div>'+(info.secureUrl && !info.secure ? '<p><a href="/setup" target="_blank" rel="noopener">Set up the HTTPS certificate ↗</a></p><p><a class="secure-link">Open secure Lane ↗</a></p>' : '<p>Keep a separate copy of your files. This backup does not contain received message history or uploaded files.</p>');
    if(root.querySelector('.secure-link'))root.querySelector('.secure-link').href=info.secureUrl;
    root.addEventListener('click',event=>{const action=event.target.closest('[data-recovery]')?.dataset.recovery;if(action)dialog(info,'phone',action);});document.querySelector('#settings-panel').append(root);
    const restoreButton=document.createElement('button');restoreButton.className='forget-button';restoreButton.type='button';restoreButton.textContent='Already paired? Restore an encrypted backup';restoreButton.onclick=()=>dialog(info,'phone','restore');document.querySelector('#pair-section').append(restoreButton);
  }
  window.LaneRecovery={pack,unpack,restore,dialog,mountMobile};
})();
