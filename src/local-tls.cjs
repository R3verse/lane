require('reflect-metadata');
const x509 = require('@peculiar/x509');
const { webcrypto, randomBytes, X509Certificate, createPrivateKey } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
x509.cryptoProvider.set(webcrypto);
const algorithm = { name:'ECDSA', namedCurve:'P-256', hash:'SHA-256' };
const serial = () => '01' + randomBytes(16).toString('hex');
const pemKey = async key => createPrivateKey({key:Buffer.from(await webcrypto.subtle.exportKey('pkcs8',key)),format:'der',type:'pkcs8'}).export({format:'pem',type:'pkcs8'});
const importKey = pem => webcrypto.subtle.importKey('pkcs8',createPrivateKey(pem).export({format:'der',type:'pkcs8'}),algorithm,true,['sign']);

class LocalTLS {
  constructor(directory, id, protect) { this.directory=path.join(directory,'tls');this.id=id;this.protect=protect; }
  async save() {
    const value=JSON.stringify(this.bundle);
    const data=this.protect ? {protected:this.protect.seal(value)} : {local:value};
    const file=path.join(this.directory,'identity.json');
    await fs.writeFile(file+'.tmp',JSON.stringify(data),{mode:0o600});
    await fs.rename(file+'.tmp',file);
  }
  async prepare(ips) {
    await fs.mkdir(this.directory,{recursive:true});
    const file=path.join(this.directory,'identity.json');
    try {
      const saved=JSON.parse(await fs.readFile(file,'utf8'));
      if (saved.protected && !this.protect) throw new Error('The HTTPS identity belongs to the original Windows user.');
      this.bundle=JSON.parse(saved.protected ? this.protect.open(saved.protected) : saved.local);
    } catch(err) { if(err.code!=='ENOENT') throw err; }
    if (!this.bundle) {
      const keys=await webcrypto.subtle.generateKey(algorithm,true,['sign','verify']);
      const root=await x509.X509CertificateGenerator.createSelfSigned({
        serialNumber:serial(),name:`CN=Lane Local CA ${this.id.slice(0,8)}`,keys,signingAlgorithm:algorithm,
        notBefore:new Date(Date.now()-86400000),notAfter:new Date(Date.now()+5*365*86400000),
        extensions:[new x509.BasicConstraintsExtension(true,0,true),new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,true),await x509.SubjectKeyIdentifierExtension.create(keys.publicKey)]
      });
      this.bundle={root:root.toString('pem'),rootKey:await pemKey(keys.privateKey)};
      await this.save();
    }
    const root=new X509Certificate(this.bundle.root);
    if(Date.parse(root.validTo)<Date.now()) throw new Error('The Lane root certificate expired. Restore or renew the HTTPS identity before connecting.');
    this.fingerprint=root.fingerprint256;
    this.name=root.subject.replace(/^CN=/,'');
    this.certificate=root.raw;
    await this.refresh(ips);
    return this;
  }
  async refresh(ips) {
    const hosts=[...new Set(['127.0.0.1',...ips])].sort();
    const names=['localhost',`lane-${this.id.slice(0,12)}.local`];
    if(this.bundle.leaf && this.bundle.hosts===JSON.stringify(hosts) && Date.parse(new X509Certificate(this.bundle.leaf).validTo)>Date.now()+30*86400000) return false;
    const root=new x509.X509Certificate(this.bundle.root);
    const keys=await webcrypto.subtle.generateKey(algorithm,true,['sign','verify']);
    const cert=await x509.X509CertificateGenerator.create({
      serialNumber:serial(),subject:`CN=${names[1]}`,issuer:root.subject,publicKey:keys.publicKey,
      signingKey:await importKey(this.bundle.rootKey),signingAlgorithm:algorithm,
      notBefore:new Date(Date.now()-86400000),notAfter:new Date(Math.min(Date.now()+90*86400000,root.notAfter.getTime())),
      extensions:[new x509.BasicConstraintsExtension(false,undefined,true),new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature,true),new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']),new x509.SubjectAlternativeNameExtension([...hosts.map(value=>({type:'ip',value})),...names.map(value=>({type:'dns',value}))]),await x509.AuthorityKeyIdentifierExtension.create(root)]
    });
    Object.assign(this.bundle,{leaf:cert.toString('pem'),leafKey:await pemKey(keys.privateKey),hosts:JSON.stringify(hosts)});
    await this.save();return true;
  }
  options() { return {key:this.bundle.leafKey,cert:this.bundle.leaf,minVersion:'TLSv1.2'}; }
  snapshot() {
    const leaf=new X509Certificate(this.bundle.leaf),root=new X509Certificate(this.bundle.root);
    return {name:this.name,fingerprint:this.fingerprint,expires:leaf.validTo,validFrom:leaf.validFrom,
      serverFingerprint:leaf.fingerprint256,hosts:leaf.subjectAltName,rootExpires:root.validTo};
  }
}
module.exports={LocalTLS};
