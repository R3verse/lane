const crypto = require('node:crypto');
function validPublicKey(key) {
  if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || key.d || !/^[A-Za-z0-9_-]{43}$/.test(key.x) || !/^[A-Za-z0-9_-]{43}$/.test(key.y) || JSON.stringify(key).length > 600) return false;
  try { crypto.createPublicKey({key,format:'jwk'});return true; } catch { return false; }
}
const samePublicKey=(a,b)=>Boolean(a && b && a.kty===b.kty && a.crv===b.crv && a.x===b.x && a.y===b.y);
module.exports={validPublicKey,samePublicKey};
