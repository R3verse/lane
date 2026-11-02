(function () {
  class TransferWakeLock {
    constructor({navigator,document,secure,onChange=()=>{}}) {
      Object.assign(this,{navigator,document,secure,onChange});
      this.enabled=true;this.active=false;this.lock=null;this.pending=null;this.closed=false;this.state='idle';
      this.onVisibility=()=>{void this.sync();};
      document.addEventListener('visibilitychange',this.onVisibility);
    }
    supported(){return this.secure && typeof this.navigator.wakeLock?.request==='function';}
    wanted(){return !this.closed && this.enabled && this.active && !this.document.hidden;}
    update(state){this.state=state;this.onChange(state);}
    setActive(value){this.active=Boolean(value);return this.sync();}
    setEnabled(value){this.enabled=Boolean(value);return this.sync();}
    async sync(){
      if(!this.wanted()){
        const lock=this.lock;this.lock=null;
        if(lock)try{await lock.release();}catch{}
        this.update(this.closed ? 'off' : !this.enabled ? 'off' : this.active && this.document.hidden ? 'hidden' : 'idle');return;
      }
      if(!this.supported()){this.update('unsupported');return;}
      if(this.lock || this.pending)return this.pending;
      this.update('requesting');
      this.pending=(async()=>{
        try{
          const lock=await this.navigator.wakeLock.request('screen');
          if(!this.wanted()){await lock.release();return;}
          this.lock=lock;
          lock.addEventListener('release',()=>{if(this.lock===lock){this.lock=null;this.update(this.wanted() ? 'released' : 'idle');}});
          if(lock.released){this.lock=null;this.update('released');}else this.update('held');
        }catch{if(this.wanted())this.update('denied');}
      })().finally(()=>{this.pending=null;});
      return this.pending;
    }
    close(){this.closed=true;this.document.removeEventListener('visibilitychange',this.onVisibility);return this.sync();}
  }
  if(typeof module!=='undefined' && module.exports){module.exports={TransferWakeLock};return;}
  const $=selector=>document.querySelector(selector);
  const display=matchMedia('(display-mode: standalone)');
  let installPrompt;
  const wake=new TransferWakeLock({navigator,document,secure:window.isSecureContext,onChange:renderWake});
  try{wake.enabled=localStorage.getItem('lane-keep-awake')!=='false';}catch{}
  $('#mobile-keep-awake').checked=wake.enabled;
  $('#mobile-keep-awake').disabled=!wake.supported();
  function renderWake(state){
    const text=!wake.supported() ? 'Requires HTTPS and a browser with screen wake-lock support. Keep Lane visible and the phone awake manually.' : {
      idle:'Ready. Lane will request this only while uploading, then release it.',off:'Off. Keep the screen awake manually during uploads.',
      requesting:'Requesting screen wake lock…',held:'Keeping the screen awake during your upload.',hidden:'Lane is hidden. Return to the page to continue reliably.',
      released:'The device released the wake lock. Keep the screen awake manually or tap Try again.',denied:'The device declined. Check battery-saving settings or keep the screen awake manually.'
    }[state];
    $('#mobile-awake-status').textContent=text;
    $('#mobile-awake-retry').hidden=!['released','denied'].includes(state);
    $('#transfer-awake-status').hidden=!wake.active;
    $('#transfer-awake-status').textContent=text;
  }
  $('#mobile-keep-awake').addEventListener('change',event=>{try{localStorage.setItem('lane-keep-awake',String(event.target.checked));}catch{}void wake.setEnabled(event.target.checked);});
  $('#mobile-awake-retry').addEventListener('click',()=>void wake.sync());
  function renderInstall(){
    const standalone=display.matches || navigator.standalone===true;
    $('#home-screen-status').textContent=standalone ? 'Opened from your Home Screen.' : 'Open Lane from an icon, with more room for your files and messages.';
    $('#home-screen-help').hidden=standalone;
    $('#install-lane').hidden=standalone || !installPrompt || !window.isSecureContext;
  }
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;renderInstall();});
  window.addEventListener('appinstalled',()=>{installPrompt=null;renderInstall();});
  display.addEventListener('change',renderInstall);
  $('#install-lane').addEventListener('click',async()=>{
    const prompt=installPrompt;if(!prompt)return;
    installPrompt=null;renderInstall();
    try{await prompt.prompt();await prompt.userChoice;}catch{$('#home-screen-status').textContent='Use your browser’s Share or menu button to add Lane to the Home Screen.';}
  });
  $('#home-screen-help').addEventListener('click',()=>$('#home-screen-dialog').showModal());
  $('#close-home-screen-help').addEventListener('click',()=>$('#home-screen-dialog').close());
  $('#home-screen-address').textContent=location.origin+'/';
  $('#home-screen-https-note').hidden=location.protocol==='https:';
  window.addEventListener('pagehide',()=>{void wake.setActive(false);});
  window.LaneWebApp={setTransferring:value=>wake.setActive(value)};
  renderInstall();renderWake('idle');
})();
