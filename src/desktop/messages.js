(function () {
  let chat, selected = '', currentState;
  const esc = window.LaneFormat.escape;
  let attendedPeer='';
  function attention(id) { if(attendedPeer===id)return;attendedPeer=id;window.lane.conversation(id).then(focused=>window.LaneWindowFocused=focused); }
  window.LaneWindowFocused=false;
  window.lane.onAttention(focused=>{window.LaneWindowFocused=focused;if(focused)chat?.tick();});
  function leave() { chat?.dispose(); chat = null;attention(''); }
  function render(state, heading) {
    currentState = state;
    if (!state.devices.some(d => d.id === selected)) selected = state.devices[0]?.id || '';
    const content = document.querySelector('#content');
    if (!document.querySelector('#messages-layout')) {
      leave();
      content.innerHTML = heading + '<section id="messages-layout" class="messages-layout"><aside class="conversation-list" aria-label="Conversations"></aside><div id="desktop-chat" class="chat-root"></div></section>';
      content.querySelector('.conversation-list').addEventListener('click', async event => {
        const button = event.target.closest('button'); if (!button) return;
        if (button.dataset.conversation) { selected = button.dataset.conversation; leave(); render(currentState, heading); }
        if (button.dataset.clearConversation && confirm(window.LaneChat.clearPrompt)) {
          const target=chat,id=selected;
          try { const result=await window.lane.clearMessages(id); if (target) { target.purge(result.generation); await target.tick(); } }
          catch (err) { chat?.feedback(err.message); }
        }
      });
    }
    const list = document.querySelector('.conversation-list');
    const scroll = list.scrollTop;
    list.innerHTML = '<p>YOUR CONVERSATIONS</p>' + state.devices.map(d => {
      const summary = state.conversations.find(c => c.deviceId === d.id);
      return `<button class="conversation-device ${selected === d.id ? 'selected' : ''}" data-conversation="${d.id}"><span>◌</span><div><strong>${esc(d.name)}</strong><small>${d.online ? 'Connected' : 'Open Lane to receive'}</small></div>${summary?.unread ? `<b>${summary.unread}</b>` : ''}</button>`;
    }).join('') + (selected ? '<button class="conversation-clear" data-clear-conversation="true">Clear conversation…</button>' : '');
    list.scrollTop = scroll;
    const device = state.devices.find(d => d.id === selected);
    if (!device) { leave(); document.querySelector('#desktop-chat').innerHTML = '<div class="messages-empty"><h2>Your words, a little closer.</h2><p>Pair a device to send messages, formatted notes and emojis.</p><button class="button primary" data-action="pair">Pair a new device</button></div>'; return; }
    if (chat && chat.options.deviceId !== selected) leave();
    if (!chat) {
      const id = selected, context = {scope:state.receiverId,viewerId:'computer',peerId:id};
      chat = new window.LaneChat(document.querySelector('#desktop-chat'), {
        key:state.receiverId + ':' + id, deviceId:id, viewerId:'computer', peer:device.name, online:device.online, direction:'outgoing', canRead:()=>window.LaneWindowFocused,secure:Boolean(window.LaneDesktopIdentity && device.publicKey),
        securityCode:device.publicKey && window.LaneDesktopIdentity ? window.LaneCrypto.fingerprint(window.LaneDesktopIdentity.publicKey,device.publicKey) : '',
        fetch:(revision,limit) => window.lane.messages(id,revision,limit),
        muted:state.mutedConversations?.includes(id),mute:value=>window.lane.muteConversation(id,value),
        send:body => window.lane.sendMessage(id,body).catch(err => { err.status = 500; throw err; }), ack:body => window.lane.acknowledgeMessages(id,body),
        encrypt: body => window.LaneCrypto.encrypt(body,window.LaneDesktopIdentity,currentState.devices.find(d=>d.id===id)?.publicKey,context),
        decrypt: message => window.LaneCrypto.decrypt(message,window.LaneDesktopIdentity,currentState.devices.find(d=>d.id===id)?.publicKey,context),
        copy:(m,mode) => (m.encrypted || m.iv) ? window.lane.copyContent({text:m.cleartext || m.text,format:m.format,mode}) : window.lane.copyMessage(id,m.id,mode), save:m => (m.encrypted || m.iv) ? window.lane.saveContent({text:m.cleartext || m.text,format:m.format}) : window.lane.saveMessage(id,m.id), react:(m,emoji) => window.lane.reactMessage(id,m.id,emoji)
      });
    } else { chat.options.secure=Boolean(window.LaneDesktopIdentity && device.publicKey); chat.updatePeer(device.name, device.online); chat.tick(); }
    attention(selected);
  }
  window.DesktopMessages = { render, leave, select:id => { selected=id;leave(); } };
})();
