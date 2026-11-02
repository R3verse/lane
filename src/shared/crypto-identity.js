(function () {
  'use strict';
  const { p256, gcm, hkdf, sha256 } = globalThis.LanePrimitives;
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8',{fatal:true});
  const b64 = bytes => { let value=''; for (const byte of bytes) value+=String.fromCharCode(byte); return btoa(value); };
  const unb64 = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const url64 = bytes => b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  function publicBytes(key) {
    if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || key.d || !/^[A-Za-z0-9_-]{43}$/.test(key.x) || !/^[A-Za-z0-9_-]{43}$/.test(key.y)) throw new Error('The other device has no valid encryption key. Reload Lane on that device.');
    const bytes=new Uint8Array(65); bytes[0]=4; bytes.set(unb64(key.x),1); bytes.set(unb64(key.y),33); p256.Point.fromBytes(bytes).assertValidity(); return bytes;
  }
  const canonical = key => b64(publicBytes(key));
  const sameKey = (a,b) => { try { return canonical(a)===canonical(b); } catch { return false; } };
  async function identity(storageKey) {
    const key='lane-e2ee:'+storageKey, raw=localStorage.getItem(key);
    if (raw) {
      const saved=JSON.parse(raw), actual=p256.getPublicKey(unb64(saved.privateKey.d),false);
      if (b64(actual)!==canonical(saved.publicKey)) throw new Error('Encryption keys could not be restored. Do not clear site data if you need old encrypted messages.');
      return saved;
    }
    const secret=p256.utils.randomSecretKey(), bytes=p256.getPublicKey(secret,false);
    const publicKey={kty:'EC',crv:'P-256',x:url64(bytes.slice(1,33)),y:url64(bytes.slice(33)),ext:true};
    const result={privateKey:{...publicKey,d:url64(secret)},publicKey};
    localStorage.setItem(key,JSON.stringify(result));
    return result;
  }
  function pin(scope, peer, key) {
    const value=canonical(key), storage='lane-peer-key:'+scope+':'+peer, previous=localStorage.getItem(storage);
    if (previous && previous!==value) throw new Error('Encryption key changed. Sending is paused. Verify the device and reconnect before continuing.');
    if (!previous) localStorage.setItem(storage,value);
  }
  function fingerprint(a,b) {
    const sorted=[canonical(a),canonical(b)].sort();
    return Array.from(sha256(encoder.encode(sorted.join('|'))),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase().match(/.{1,4}/g).join(' ');
  }
  function aad(m) { return encoder.encode(JSON.stringify(['lane-message-v2',m.senderId,m.recipientId,m.clientId,m.format])); }
  function derive(own,peer,version) {
    const shared=p256.getSharedSecret(unb64(own.privateKey.d),publicBytes(peer),false).slice(1,33);
    if (version!==2) return shared; // Read-only compatibility with the unreleased v1 preview.
    const context=[canonical(own.publicKey),canonical(peer)].sort().join('|');
    return hkdf(sha256,shared,encoder.encode('Lane E2EE v2'),encoder.encode(context),32);
  }
  async function encrypt(body, own, peer, context) {
    if (!own || !peer) throw new Error('Encryption is not ready. Open and reload Lane on the other device. Your message remains queued.');
    pin(context.scope,context.peerId,peer);
    const metadata={...body,senderId:context.viewerId,recipientId:context.peerId};
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const cipher=gcm(derive(own,peer,2),iv,aad(metadata)).encrypt(encoder.encode(body.text));
    return {encrypted:true,cryptoVersion:2,text:b64(cipher),iv:b64(iv),publicKey:own.publicKey};
  }
  async function decrypt(message, own, peer, context) {
    if (!message.encrypted) return message;
    try {
      pin(context.scope,context.peerId,peer);
      const expectedSender=message.senderId===context.viewerId ? own.publicKey : peer;
      if (!sameKey(message.senderPublicKey,expectedSender)) throw new Error('Sender key mismatch.');
      const text=decoder.decode(gcm(derive(own,peer,message.cryptoVersion),unb64(message.iv),message.cryptoVersion===2 ? aad(message) : undefined).decrypt(unb64(message.text)));
      return {...message,text,cleartext:text};
    } catch {
      return {...message,text:'Encrypted message unavailable. Its key or content could not be verified. Lost keys cannot be restored by pairing again.',decryptionFailed:true};
    }
  }
  globalThis.LaneCrypto={identity,encrypt,decrypt,pin,sameKey,fingerprint};
})();
