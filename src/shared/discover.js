(function(){
  const esc=value=>window.LaneFormat.escape(String(value ?? ''));
  const shapes={phone:'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM10 18h4',tablet:'M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',computer:'M3 3h18v13H3zM8 21h8M12 16v5',browser:'M3 3h18v18H3zM3 8h18M6 5h1M10 5h1'};
  const icon=kind=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${shapes[kind] || shapes.browser}"/></svg>`;
  class Discover {
    constructor(root,actions) {
      this.root=root;this.actions=actions;this.query='';this.filter='all';this.signature='';
      root.innerHTML='<section class="discover-hero"><div class="discover-radar" aria-hidden="true"><span>↗</span></div><div><span class="eyebrow">A LITTLE CLOSER</span><h2>Your local circle.</h2><p>Find a familiar device. Start a conversation. Send something over.</p><span class="discover-summary" role="status"></span></div></section><div class="discover-toolbar"><label>Find a device<input class="discover-search" type="search" placeholder="Search name or device type…"></label><div class="discover-filters" role="group" aria-label="Show devices"><button data-discover-filter="all" aria-pressed="true">All devices</button><button data-discover-filter="online" aria-pressed="false">Connected</button><button data-discover-filter="nearby" aria-pressed="false">Nearby computers</button></div></div><div class="discover-grid" aria-label="Discovered devices"></div><p class="discover-explainer"></p>';
      root.querySelector('input').addEventListener('input',event=>{this.query=event.target.value;this.renderCards();});
      root.querySelector('.discover-filters').insertAdjacentHTML('beforeend','<button data-discover-filter="paired" aria-pressed="false">Paired</button>');
      root.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.discoverFilter){this.filter=button.dataset.discoverFilter;this.renderCards();}if(button.dataset.discoverDevice)this.details(button.dataset.discoverDevice);});
      this.dialog=document.createElement('dialog');this.dialog.className='discover-dialog';this.dialog.setAttribute('aria-label','Device details');document.body.append(this.dialog);
      this.dialog.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const action=button.dataset.discoverAction;if(action==='close'){this.dialog.close();return;}const item=this.items.find(d=>d.key===this.selected);if(!item)return;this.dialog.close();this.actions[action]?.(item);});
    }
    update(devices,nearby={status:'off',computers:[]}) {
      this.nearby=nearby;
      this.items=[...devices.map(d=>({...d,key:'paired:'+d.id,paired:true})),...nearby.computers.map(d=>({...d,key:'nearby:'+d.id,paired:false,online:true,profile:{kind:'computer',platform:'Lane computer',browser:'Bonjour'}}))];
      const signature=JSON.stringify(this.items.map(({lastSeen,pairedAt,...item})=>item))+nearby.status;
      if(signature===this.signature)return;this.signature=signature;this.renderCards();
      if(this.dialog.open)this.renderDetails();
    }
    renderCards() {
      const list=this.items.filter(d=>(this.filter==='all' || this.filter==='paired' && d.paired || this.filter==='online' && d.paired && d.online || this.filter==='nearby' && !d.paired) && [d.name,d.profile?.kind,d.profile?.platform].join(' ').toLowerCase().includes(this.query.toLowerCase())).sort((a,b)=>Number(b.paired && b.online)-Number(a.paired && a.online)||a.name.localeCompare(b.name));
      const grid=this.root.querySelector('.discover-grid'),scroll=grid.scrollTop;
      this.root.querySelectorAll('[data-discover-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.discoverFilter===this.filter)));
      this.root.querySelector('.discover-summary').textContent=`${this.items.filter(d=>d.paired && d.online).length} connected · ${this.items.filter(d=>!d.paired).length} nearby computers`;
      grid.innerHTML=list.length ? list.map(d=>`<button class="discover-device ${d.online ? 'online' : ''}" data-discover-device="${esc(d.key)}"><span class="discover-device-top"><span class="discover-device-icon">${icon(d.profile?.kind)}</span><span class="discover-status">${d.paired ? d.online ? '● Connected' : '○ Offline' : '◇ Nearby'}</span></span><strong>${esc(d.name)}</strong><span class="discover-meta">${esc(d.profile?.platform || 'Paired browser')}${d.unread ? ` · ${d.unread} unread` : ''}</span><span class="discover-card-action">${d.paired ? 'View device & interact' : 'View pairing options'} <span>↗</span></span></button>`).join('') : '<div class="discover-empty"><h3>No devices here yet.</h3><p>Open Lane on a paired device, or pair a new phone using this computer’s QR code.</p></div>';
      grid.scrollTop=scroll;
      this.root.querySelector('.discover-explainer').textContent='Phones and tablets appear after pairing and opening Lane. Other Lane computers can appear through Bonjour before pairing. '+(this.nearby.status==='off' ? 'Bonjour is off in the computer’s Settings.' : this.nearby.status==='unavailable' ? 'Bonjour is unavailable on this network. Use QR pairing.' : 'Discovery refreshes automatically; Wi-Fi isolation can hide nearby computers.');
    }
    details(key){this.selected=key;this.renderDetails();this.dialog.showModal();}
    renderDetails(){
      const d=this.items.find(item=>item.key===this.selected);
      if(!d){this.dialog.close();return;}
      this.dialog.innerHTML=`<button class="discover-close" data-discover-action="close" aria-label="Close device details">×</button><span class="discover-detail-icon">${icon(d.profile?.kind)}</span><span class="eyebrow">${d.paired ? 'YOUR LOCAL CIRCLE' : 'NEARBY LANE COMPUTER'}</span><h2>${esc(d.name)}</h2><p>${d.paired ? d.online ? 'Connected and ready for files and messages.' : 'Paired, but currently offline. Messages and files can wait here until it reconnects.' : 'Found on your network. Pair in its browser page before sending anything.'}</p><dl><div><dt>Device</dt><dd>${esc(d.profile?.platform || 'Unknown system')}</dd></div><div><dt>Client</dt><dd>${esc(d.profile?.browser || 'Browser')}</dd></div><div><dt>Connection</dt><dd>${d.paired ? 'Through this Lane computer' : esc(d.address)}</dd></div><div><dt>Protection</dt><dd>${d.paired ? d.publicKey ? 'Message bodies encrypted end to end' : 'Encryption key not registered yet' : d.secure ? 'HTTPS advertised · verify its certificate' : 'HTTP advertised · ask the owner to enable HTTPS'}</dd></div></dl><p class="discover-fineprint">${d.paired ? 'Device type is estimated from its browser. Display names are editable by their owners.' : 'Nearby names are self-reported. Check the intended computer’s screen and use its pairing code.'}</p><div class="discover-detail-actions">${d.paired ? '<button class="primary" data-discover-action="message">Message ❝</button><button data-discover-action="send">Send files ↑</button>' : '<button class="primary" data-discover-action="open">Open to pair ↗</button>'}</div>`;
      if(d.paired && this.actions.remove)this.dialog.querySelector('.discover-detail-actions').insertAdjacentHTML('beforeend','<button data-discover-action="remove">Remove device</button>');
    }
    dispose(){this.dialog.remove();}
  }
  window.LaneDiscover=Discover;
})();
