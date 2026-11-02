const { Bonjour } = require('bonjour-service');
const net = require('node:net');
function localIPv4(ip) {
  return net.isIPv4(ip) && (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
}
function entry(service,ownId) {
  const id=String(service.txt?.id || ''), address=(service.addresses || []).find(localIPv4);
  if (!/^[0-9a-f-]{36}$/.test(id) || id===ownId || !address || !Number.isInteger(service.port) || service.port<1 || service.port>65535 || service.txt?.protocol!=='lane-1') return null;
  const secure=service.txt?.https==='1';
  return {id,name:String(service.txt?.name || service.name || 'Lane computer').slice(0,60),url:`${secure ? 'https' : 'http'}://${address}:${service.port}`,address,...(secure ? {secure:true} : {})};
}
class Discovery {
  constructor(receiver,create=()=>new Bonjour({},()=>this.failed())) { this.receiver=receiver;this.create=create;this.peers=new Map();this.status='off'; }
  start() {
    this.stop();
    if (!this.receiver.state.settings.nearbyDiscovery) return;
    try {
      this.status='searching';this.bonjour=this.create();
      const {receiverId,settings}=this.receiver.state;
      this.service=this.bonjour.publish({name:`Lane ${receiverId.slice(0,8)}`,host:`lane-${receiverId.slice(0,12)}.local`,type:'lane',protocol:'tcp',port:settings.httpsOnly ? this.receiver.tlsPort : this.receiver.port,disableIPv6:true,txt:{id:receiverId,name:settings.computerName,protocol:'lane-1',https:settings.httpsOnly ? '1' : '0'}});
      this.service.on('error',()=>this.failed());
      const up=service=>{const peer=entry(service,receiverId);if(!peer || (this.peers.size>=64 && !this.peers.has(peer.id)))return;this.peers.set(peer.id,{...peer,seen:Date.now()});this.receiver.changed();};
      const scan=()=>{
        this.browser?.stop();this.browser?.removeAllListeners();
        this.browser=this.bonjour.find({type:'lane',protocol:'tcp'});
        this.browser.on('up',up);this.browser.on('txt-update',up);this.browser.on('srv-update',up);
        this.browser.on('down',service=>{this.peers.delete(String(service.txt?.id));this.receiver.changed();});
        for(const[id,peer]of this.peers)if(Date.now()-peer.seen>180000)this.peers.delete(id);
        this.receiver.changed();
      };
      scan();this.timer=setInterval(scan,60000).unref();
    } catch { this.failed(); }
  }
  failed() { this.status='unavailable';this.receiver.changed(); }
  snapshot() { return {status:this.status,computers:[...this.peers.values()].map(({seen,...peer})=>peer)}; }
  stop() { clearInterval(this.timer);this.browser?.stop();this.service?.stop();this.bonjour?.destroy();this.browser=this.service=this.bonjour=null;this.peers.clear();this.status='off'; }
}
module.exports={Discovery,entry};
