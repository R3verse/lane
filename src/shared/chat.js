(function () {
  const F = window.LaneFormat, esc = F.escape;
  const uid = () => { const bytes = new Uint8Array(20); crypto.getRandomValues(bytes); return Array.from(bytes, n => n.toString(16).padStart(2,'0')).join(''); };
  const time = n => new Date(n).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  class LaneChat {
    constructor(root, options) {
      this.root = root; this.options = options; this.key = 'lane-chat:' + options.key;
      this.items = []; this.pending = []; this.revision = -1; this.limit = 50; this.total = 0; this.expanded = new Set(); this.reacting = new Set(); this.busy = false; this.closed = false;
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(this.key) || '{}'); } catch {}
      this.generation=saved.generation || '0';this.run=0;
      this.query='';this.muted=options.muted ?? LaneChat.isMuted(options.key);
      this.pending = Array.isArray(saved.pending) ? saved.pending : [];
      root.innerHTML = `<div class="chat-heading"><div><span class="chat-kicker">LOCAL MESSAGES</span><h2 class="chat-peer"></h2></div><div class="chat-heading-actions"><span class="chat-presence"></span><button class="chat-info" type="button" data-chat="security" aria-label="Conversation security" title="Conversation security">ⓘ</button></div></div>
        <div class="chat-explainer">A chat, a quick thought, a whole note. Just between your devices.<br><span class="chat-security">${options.secure ? '🔒 End-to-end encrypted · ' : ''}No internet or SIM needed · Same network · No carrier SMS</span></div>
        <dialog class="chat-verification" aria-label="Conversation security"><div class="chat-reader-top"><h2>Conversation security</h2><button type="button" data-chat="close-security" aria-label="Close conversation security">×</button></div><p>Compare this code on both devices to verify the conversation keys.</p><code>${esc(options.securityCode || 'Open Lane on the other device to enable encryption.')}</code><p>Message bodies are encrypted. Metadata and reactions are visible to the computer. Use verified HTTPS for the phone page to protect code delivery and transport. The hosting computer controls the browser code; device keys cannot protect a compromised client.</p><p>Clearing a conversation removes its Lane history, reactions, drafts and queued text on both participants when they reconnect. Saved notes, clipboard copies and external backups cannot be erased remotely. Lane cannot promise forensic erasure from browser storage or disks.</p></dialog>
        <div class="chat-log" role="log" aria-label="Conversation"><div class="chat-history"></div></div>
        <button class="chat-unread-jump" type="button" hidden>New messages ↓</button><div class="chat-editor"><div class="chat-editor-top"><label>Message format <select class="chat-format" aria-label="Message format"><option value="plain">Plain text</option><option value="markdown">Formatted note</option></select></label><button type="button" data-chat="preview" aria-pressed="false">Preview</button></div>
        <div class="chat-tools" role="toolbar" aria-label="Text formatting"><button type="button" data-wrap="bold" title="Bold" aria-label="Bold"><b>B</b></button><button type="button" data-wrap="italic" title="Italic" aria-label="Italic"><i>I</i></button><button type="button" data-wrap="heading" title="Heading" aria-label="Heading">H</button><button type="button" data-wrap="list" title="Bullet list" aria-label="Bullet list">• List</button><button type="button" data-wrap="quote" title="Quote" aria-label="Quote">❞</button><button type="button" data-wrap="code" title="Code" aria-label="Code">&lt;/&gt;</button><span></span><button type="button" data-chat="emoji" aria-expanded="false" aria-label="Insert emoji">☺</button></div>
        <div class="chat-emojis" hidden>${['😊','❤️','👍','🎉','✨','👋','✅','📌','💡','🔥','😂','🙏'].map(e => `<button type="button" data-emoji="${e}" aria-label="Insert ${e}">${e}</button>`).join('')}</div>
        <textarea class="chat-input" aria-label="Message" placeholder="Write a message, paste a note, add an emoji…" maxlength="100000" rows="4"></textarea><div class="chat-preview message-body" hidden></div>
        <div class="chat-editor-bottom"><span class="chat-counter"></span><button type="button" class="chat-send" data-chat="send">Send message <span>↑</span></button></div><div class="chat-hint">Enter for a new line · Ctrl/⌘ + Enter to send · Drafts stay on this device</div></div>
        <p class="chat-feedback" role="status"></p><p class="chat-network-note">Keep Lane open on both devices. If the connection drops, queued text sends when this page reconnects. This is local chat, not SMS to phone numbers.</p>
        <dialog class="chat-reader" aria-label="Full message reading view"><div class="chat-reader-top"><div><span class="chat-kicker">FULL MESSAGE</span><h2 id="chat-reader-title">Message</h2></div><button type="button" data-reader="close" aria-label="Close full message">×</button></div><div class="chat-reader-tools"><button type="button" data-reader="smaller" aria-label="Smaller text">A−</button><span data-reader="size">100%</span><button type="button" data-reader="larger" aria-label="Larger text">A＋</button><button type="button" data-reader="copy">Copy text</button></div><div class="chat-reader-body message-body"></div></dialog>`;
      root.querySelector('.chat-explainer').insertAdjacentHTML('afterend','<div class="chat-search-tools"><label>Find in conversation<input type="search" class="chat-search" placeholder="Search text or emoji…" maxlength="200"></label><button type="button" data-chat="mute" aria-pressed="false">Mute alerts</button></div><p class="chat-search-status" role="status" hidden></p>');
      root.querySelector('.chat-search-tools').hidden=true;
      const headingActions=root.querySelector('.chat-heading-actions');
      headingActions.append(root.querySelector('[data-chat="mute"]'));
      headingActions.insertAdjacentHTML('beforeend','<button type="button" class="chat-info" data-chat="search" aria-label="Search conversation" title="Search conversation" aria-expanded="false">⌕</button>');
      root.querySelector('.chat-search').addEventListener('input',event=>{this.query=event.target.value;this.render();root.querySelector('.chat-log').scrollTop=0;});
      this.renderMute();
      this.input = root.querySelector('.chat-input'); this.format = root.querySelector('.chat-format');
      this.input.value = saved.draft || ''; this.format.value = saved.format === 'markdown' ? 'markdown' : 'plain';
      this.input.addEventListener('input', () => this.edit());
      this.format.addEventListener('change', () => this.edit());
      this.input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.enqueue(); } });
      root.querySelector('.chat-unread-jump').addEventListener('click',()=>{const log=root.querySelector('.chat-log');log.scrollTop=log.scrollHeight;this.tick();});
      this.reader = root.querySelector('.chat-reader'); this.readerSize = 100;
      this.reader.addEventListener('click', e => this.readerClick(e));
      this.reader.addEventListener('cancel', () => this.closeReader());
      this.onCleared=event=>{if(event.detail.key===this.key && event.detail.generation!==this.generation)this.purge(event.detail.generation);};
      this.onStorage=event=>{if(event.key===this.key && event.newValue){try{const saved=JSON.parse(event.newValue);if(saved.generation && saved.generation!==this.generation)this.purge(saved.generation);}catch{}}};
      window.addEventListener('lane:conversation-cleared',this.onCleared);
      window.addEventListener('storage',this.onStorage);
      root.addEventListener('click', e => this.click(e));
      root.querySelector('.chat-log').addEventListener('scroll', () => { clearTimeout(this.scrollTimer); this.scrollTimer = setTimeout(() => this.tick(), 300); });
      this.updatePeer(options.peer, options.online); this.edit(false); this.render(); this.tick();
      this.timer = setInterval(() => this.tick(), 3000);
    }
    dispose() { this.closed = true;this.run++;clearInterval(this.timer);clearTimeout(this.scrollTimer);window.removeEventListener('lane:conversation-cleared',this.onCleared);window.removeEventListener('storage',this.onStorage);this.items=[];this.pending=[];this.closeReader(); }
    feedback(text) { if (!this.closed) this.root.querySelector('.chat-feedback').textContent = text; }
    persist() { localStorage.setItem(this.key, JSON.stringify({ generation:this.generation, draft:this.input.value, format:this.format.value, pending:this.pending })); }
    static isMuted(key) { try{return localStorage.getItem('lane-muted:'+key)==='true';}catch{return false;} }
    renderMute() { const button=this.root.querySelector('[data-chat="mute"]');button.className='chat-info';button.textContent=this.muted ? '🔕' : '🔔';button.setAttribute('aria-label',this.muted ? 'Unmute alerts' : 'Mute alerts');button.setAttribute('aria-pressed',String(this.muted));button.title=this.muted ? 'Unmute this conversation' : 'Mute banners and sound on this device. Unread counts still update.'; }
    static synchronize(key, generation='0') {
      const storageKey='lane-chat:'+key;
      let saved;try{saved=JSON.parse(localStorage.getItem(storageKey) || 'null');}catch{}
      if((saved?.generation || '0')===generation)return;
      localStorage.setItem(storageKey,JSON.stringify({generation,draft:'',format:'plain',pending:[]}));
      window.dispatchEvent(new CustomEvent('lane:conversation-cleared',{detail:{key:storageKey,generation}}));
    }
    purge(generation) {
      if(this.closed)return;
      this.run++;this.generation=generation;this.revision=-1;this.total=0;this.limit=50;
      this.items=[];this.pending=[];this.expanded.clear();this.reacting.clear();
      this.query='';this.root.querySelector('.chat-search').value='';
      this.input.value='';this.format.value='plain';this.input.hidden=false;
      this.root.querySelector('.chat-preview').hidden=true;
      const preview=this.root.querySelector('[data-chat="preview"]');preview.textContent='Preview';preview.setAttribute('aria-pressed','false');
      this.closeReader();this.root.querySelectorAll('.chat-copy-fallback').forEach(el=>el.remove());
      this.root.querySelector('.chat-history').replaceChildren();this.lastHtml='';
      this.persist();this.edit(false);this.render();
      this.feedback('Conversation cleared. Lane history, drafts and queued text have been removed from this device.');
    }
    edit(save = true) {
      if (save) try { this.persist(); } catch { this.feedback('Browser storage is full or unavailable. Keep this page open and copy your draft before leaving.'); }
      this.root.querySelector('.chat-counter').textContent = `${this.input.value.length.toLocaleString('en-GB')} / 100,000`;
      this.root.querySelector('.chat-preview').innerHTML = F.html(this.input.value || 'Your preview appears here.', this.format.value);
      this.root.querySelector('.chat-send').disabled = !this.input.value.trim();
    }
    updatePeer(name, online) {
      this.root.querySelector('.chat-peer').textContent = name;
      const presence = this.root.querySelector('.chat-presence');
      presence.textContent = online ? '● Connected' : '○ Waiting for connection'; presence.classList.toggle('offline', !online);
      const security = this.root.querySelector('.chat-security');
      if (security) security.textContent = `${this.options.secure ? '🔒 Encrypted messages · ' : 'Encryption waiting for the other device · '}Same network · No carrier SMS`;
    }
    async enqueue() {
      if (!this.input.value.trim()) return;
      if (this.input.value.length > 100_000) { this.feedback('This note is too long. Keep it under 100,000 characters or send it as a file. Your draft is still here.'); return; }
      const item = { clientId:uid(), text:this.input.value, format:this.format.value, created:Date.now() };
      if (this.pending.length >= 20 || JSON.stringify(this.pending).length + item.text.length > 500_000) { this.feedback('Your local queue is full. Reconnect to send waiting messages first.'); return; }
      this.pending.push(item);
      try { this.persist(); } catch { this.pending.pop(); this.feedback('Could not save this message to the local queue. Free browser storage or copy your text first.'); return; }
      this.input.value = ''; this.input.hidden = false; this.root.querySelector('.chat-preview').hidden = true;
      const preview = this.root.querySelector('[data-chat="preview"]'); preview.textContent = 'Preview'; preview.setAttribute('aria-pressed','false');
      this.edit(); this.render(true); this.feedback('Message queued. It will send when the other device is reachable.');
      await this.tick();
    }
    async tick() {
      if (this.closed || this.busy) return;
      this.busy = true;
      let run=this.run;
      try {
        // Learn about clears before retrying any offline queue (including backups).
        let result = await this.options.fetch(this.revision, this.limit);
        if(this.closed || run!==this.run)return;
        if((result.generation || '0')!==this.generation){this.purge(result.generation || '0');run=this.run;}
        for (const item of [...this.pending]) {
          if (this.closed || run!==this.run) return;
          if (item.error) continue;
          try {
            if (!item.envelope) {
              item.envelope = await this.options.encrypt(item);
              if(this.closed || run!==this.run)return;
              if (!item.envelope?.encrypted) throw new Error('Encryption is not ready. Your message remains queued.');
              this.persist(); // Preserve ciphertext and nonce when a response is lost or the page reloads.
            }
            await this.options.send({ ...item.envelope, generation:this.generation, clientId:item.clientId, format:item.format });
            if(this.closed || run!==this.run)return;
            this.pending = this.pending.filter(m => m !== item); this.persist(); this.revision = -1;
            this.feedback('Message sent.');
          } catch (err) {
            if(this.closed || run!==this.run)return;
            if (err.status && err.status >= 400 && err.status < 500) { item.error = err.message; this.persist(); }
            else { this.feedback(err.message || 'Waiting for a connection. Your queued text is saved on this device.'); }
            break;
          }
        }
        if(this.revision===-1) result = await this.options.fetch(this.revision, this.limit);
        if (this.closed || run!==this.run) return;
        if((result.generation || '0')!==this.generation){this.purge(result.generation || '0');run=this.run;}
        if (!result.unchanged) {
          const decrypted = this.options.decrypt ? await Promise.all(result.messages.map(message => this.options.decrypt(message))) : result.messages;
          if(this.closed || run!==this.run)return;
          this.items = decrypted;
          this.total = result.total; this.revision = result.revision;
        }
        this.render();
        const received = this.items.filter(m => m.direction !== this.options.direction && !m.receivedAt).map(m => m.id);
        if (received.length) await this.options.ack({ ids:received, read:false });
        if (!this.query.trim() && !document.hidden && (this.options.canRead?.() ?? true) && this.root.getClientRects().length && !document.querySelector('dialog[open]')) {
          const log = this.root.querySelector('.chat-log').getBoundingClientRect();
          const opened = this.items.filter(m => {
            if (m.direction === this.options.direction || m.readAt || m.decryptionFailed) return false;
            const r = this.root.querySelector(`[data-message="${m.id}"]`)?.getBoundingClientRect();
            return r && r.bottom > Math.max(log.top, 0) && r.top < Math.min(log.bottom, window.innerHeight);
          }).map(m => m.id);
          if (opened.length) { await this.options.ack({ ids:opened, read:true });for(const m of this.items)if(opened.includes(m.id))m.readAt=Date.now();this.render(); }
        }
        this.options.onUpdate?.(this.items);
      } catch (err) { this.feedback(err.status === 401 || err.status === 404 ? 'This device is no longer paired. Reconnect from Lane.' : 'Waiting for the computer. Keep this page open to reconnect.'); }
      finally { this.busy = false; }
    }
    render(forceBottom = false) {
      if (this.closed) return;
      const log = this.root.querySelector('.chat-log'), history = this.root.querySelector('.chat-history');
      const atBottom = forceBottom || log.scrollHeight - log.scrollTop - log.clientHeight < 70;
      const html = (this.total > this.items.length ? '<button class="chat-earlier" type="button" data-chat="earlier">Load earlier messages</button>' : '') + (this.items.length || this.pending.length ? this.items.map(m => this.bubble(m)).join('') + this.pending.map(m => `<article class="chat-message mine pending"><div class="message-body message-plain">${esc(m.text.slice(0,1800))}${m.text.length > 1800 ? '…' : ''}</div><div class="message-meta">${time(m.created)} · ${m.error ? 'Needs attention' : 'Queued on this device'}</div>${m.error ? `<p class="message-error">${esc(m.error)}</p><button type="button" data-retry-message="${m.clientId}">Retry</button>` : ''}<button type="button" data-discard-message="${m.clientId}">Remove from queue</button></article>`).join('') : `<div class="chat-empty"><span>❝</span><h3>A little space for your words.</h3><p>Send a quick message or a longer note.<br>Emojis and line breaks are welcome.</p><div>LOCAL CHAT · NO INTERNET NEEDED</div></div>`);
      if (html !== this.lastHtml) { history.innerHTML = html; this.lastHtml = html; if (atBottom) log.scrollTop = log.scrollHeight; }
      const unread=this.items.filter(m=>m.direction!==this.options.direction && !m.readAt).length;
      const needle=this.query.trim().toLocaleLowerCase();
      const searchStatus=this.root.querySelector('.chat-search-status');searchStatus.hidden=!needle;
      let matches=0;
      for(const message of this.items){const node=history.querySelector(`[data-message="${message.id}"]`);if(!node)continue;node.hidden=Boolean(needle && !(message.cleartext || message.text || '').toLocaleLowerCase().includes(needle));if(!node.hidden)matches++;}
      history.querySelectorAll('.pending').forEach(node=>node.hidden=Boolean(needle));
      if(needle) { searchStatus.textContent=`${matches} matches in ${this.items.length} loaded messages. Search stays on this device.`;if(this.total>this.items.length && this.limit<1000)searchStatus.insertAdjacentHTML('beforeend',' <button type="button" data-chat="search-history">Search up to 1,000 recent messages</button>');else if(this.total>this.items.length)searchStatus.append(' Only the latest 1,000 messages are searchable.'); }
      const jump=this.root.querySelector('.chat-unread-jump');jump.hidden=!unread || log.scrollHeight-log.scrollTop-log.clientHeight<70;jump.textContent=unread+' unread · Jump to latest ↓';
      if(needle)jump.hidden=true;
    }
    bubble(m) {
      const messageText = m.cleartext || m.text;
      const mine = m.direction === this.options.direction, long = messageText.length > 1800, expanded = this.expanded.has(m.id);
      const text = long && !expanded ? messageText.slice(0,1800) + '…' : messageText;
      const status = mine ? m.readAt ? '✓✓ Read' : m.receivedAt ? '✓✓ Delivered · Not read' : '◷ Queued · waiting for the other device' : 'Received';
      const reactions = m.reactions || [], emojis = ['❤️','👍','😊','😂','🎉','👀'];
      const reactionUI = this.options.react ? `<div class="message-reactions">${emojis.filter(e=>reactions.some(r=>r.emoji === e)).map(e=>`<button type="button" class="reaction-chip" data-react-message="${m.id}" data-reaction="${e}" aria-label="Reaction ${e}" aria-pressed="${reactions.some(r=>r.emoji === e && r.actorId === this.options.viewerId)}">${e} ${reactions.filter(r=>r.emoji === e).length}</button>`).join('')}<button type="button" class="reaction-add" data-react-picker="${m.id}" aria-label="React to message" aria-expanded="${this.reacting.has(m.id)}">☺ +</button></div>${this.reacting.has(m.id) ? `<div class="reaction-picker" role="group" aria-label="Choose a reaction">${emojis.map(e=>`<button type="button" data-react-message="${m.id}" data-reaction="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>` : ''}` : '';
      const reader = messageText.length > 320 ? `<button type="button" data-reader-message="${m.id}">${long ? 'Open full text' : 'Open reading view'}</button>` : '';
      return `<article class="chat-message ${mine ? 'mine' : 'theirs'}" data-message="${m.id}"><span class="message-kind">${m.format === 'markdown' ? 'FORMATTED NOTE' : mine ? 'YOU' : 'MESSAGE'}</span><div class="message-body">${F.html(text,m.format)}</div>${long ? `<button type="button" data-expand-message="${m.id}">${expanded ? 'Show less' : `Read full note · ${messageText.length.toLocaleString('en-GB')} characters`}</button>` : ''}${reader}${reactionUI}<div class="message-meta ${mine && m.readAt ? 'message-read' : ''}" title="${mine ? m.readAt ? 'The message was visible in the recipient’s conversation.' : m.receivedAt ? 'Delivered to the recipient. The conversation has not been read yet.' : 'Kept in the local queue until the recipient receives it.' : ''}">${time(m.created)} · ${status}</div><div class="message-actions"><button type="button" data-copy-message="${m.id}" data-mode="plain">Copy text</button>${m.format === 'markdown' ? `<button type="button" data-copy-message="${m.id}" data-mode="formatted">Copy formatted</button><button type="button" data-copy-message="${m.id}" data-mode="source">Copy Markdown</button>` : ''}<button type="button" data-save-message="${m.id}">Save note ↓</button></div></article>`;
    }
    async click(event) {
      const button = event.target.closest('button'); if (!button || !this.root.contains(button)) return;
      const data = button.dataset;
      try {
        if (data.chat === 'send') await this.enqueue();
        if (data.chat === 'search') {const panel=this.root.querySelector('.chat-search-tools');panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)panel.querySelector('input').focus();else{this.query='';panel.querySelector('input').value='';this.render();}}
        if (data.chat === 'search-history') {this.limit=1000;this.revision=-1;await this.tick();}
        if (data.chat === 'mute') {const next=!this.muted;if(this.options.mute)await this.options.mute(next);localStorage.setItem('lane-muted:'+this.options.key,String(next));this.muted=next;this.renderMute();this.feedback(next ? 'Conversation muted on this device. Unread counts still update.' : 'Conversation alerts enabled.');}
        if (data.chat === 'security') this.root.querySelector('.chat-verification').showModal();
        if (data.chat === 'close-security') this.root.querySelector('.chat-verification').close();
        if (data.reactPicker) { this.reacting.has(data.reactPicker) ? this.reacting.delete(data.reactPicker) : this.reacting.add(data.reactPicker); this.render(); }
        if (data.reactMessage) {
          const m = this.items.find(m=>m.id === data.reactMessage);
          if (m) {
            const selected = (m.reactions || []).some(r=>r.actorId === this.options.viewerId && r.emoji === data.reaction);
            await this.options.react(m,selected ? null : data.reaction);
            this.reacting.delete(m.id); this.revision = -1; await this.tick();
          }
        }
        if (data.chat === 'preview') {
          const preview = this.root.querySelector('.chat-preview'); preview.hidden = !preview.hidden; this.input.hidden = !preview.hidden;
          button.setAttribute('aria-pressed', String(!preview.hidden)); button.textContent = preview.hidden ? 'Preview' : 'Edit';
        }
        if (data.chat === 'emoji') { const panel = this.root.querySelector('.chat-emojis'); panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); }
        if (data.emoji || data.wrap) {
          let start = this.input.selectionStart, end = this.input.selectionEnd, selected = this.input.value.slice(start,end);
          const wraps = { bold:['**','**','bold text'], italic:['*','*','italic text'], heading:['## ','','Heading'], list:['- ','','List item'], quote:['> ','','Quote'], code:['`','`','code'] };
          let inserted = data.emoji;
          if (data.wrap) {
            const [prefix,suffix,placeholder] = wraps[data.wrap]; if (!prefix && prefix !== '') return;
            this.format.value = 'markdown';
            inserted = prefix + (selected || placeholder) + suffix;
            if (['heading','list','quote'].includes(data.wrap) && start && this.input.value[start-1] !== '\n') inserted = '\n' + inserted;
          }
          if (this.input.value.length - (end - start) + inserted.length > 100_000) { this.feedback('This note has reached the 100,000-character limit. Shorten it before adding more.'); return; }
          this.input.setRangeText(inserted,start,end,'end'); this.input.hidden = false; this.root.querySelector('.chat-preview').hidden = true;
          const previewButton = this.root.querySelector('[data-chat="preview"]'); previewButton.textContent = 'Preview'; previewButton.setAttribute('aria-pressed','false');
          this.input.focus(); this.edit();
          if (data.emoji) { this.root.querySelector('.chat-emojis').hidden = true; this.root.querySelector('[data-chat="emoji"]').setAttribute('aria-expanded','false'); }
        }
        if (data.chat === 'earlier') { this.limit += 50; this.revision = -1; await this.tick(); }
        if (data.expandMessage) { this.expanded.has(data.expandMessage) ? this.expanded.delete(data.expandMessage) : this.expanded.add(data.expandMessage); this.render(); }
        if (data.readerMessage) { const message = this.items.find(item => item.id === data.readerMessage); if (message) this.openReader(message); }
        if (data.retryMessage) { delete this.pending.find(m => m.clientId === data.retryMessage)?.error; this.persist(); await this.tick(); }
        if (data.discardMessage && confirm('Remove this queued message? It will no longer be retried. A message already accepted by the computer may still be delivered.')) { this.pending = this.pending.filter(m => m.clientId !== data.discardMessage); this.persist(); this.render(); }
        const m = this.items.find(m => m.id === (data.copyMessage || data.saveMessage));
        if (m?.decryptionFailed) { this.feedback('This message could not be decrypted. Nothing was copied or saved.'); return; }
        if (m && data.copyMessage) {
          let copied = this.options.copy ? await this.options.copy(m, data.mode) : false;
          if (copied === false) copied = await this.copy(m,data.mode);
          if (copied !== false) this.feedback(data.mode === 'formatted' ? 'Formatted text copied. Paste into an app that supports formatting.' : 'Text copied.');
        }
        if (m && data.saveMessage) {
          const saved = this.options.save ? await this.options.save(m) : false;
          if (saved) this.feedback('Note saved.');
          else if (!this.options.save) {
            const saveText = (m.cleartext || (m.encrypted ? this.root.querySelector(`[data-message="${m.id}"] .message-body`)?.innerText || '' : m.text)).replace(/\r/g,'');
            const url = URL.createObjectURL(new Blob([saveText], { type:'text/plain;charset=utf-8' }));
            const a = document.createElement('a'); a.href = url; a.download = `Lane-note-${new Date(m.created).toISOString().slice(0,10)}.${m.format === 'markdown' ? 'md' : 'txt'}`; a.click(); setTimeout(() => URL.revokeObjectURL(url),60000);
            this.feedback('Check your browser downloads for the note.');
          }
        }
      } catch (err) { this.feedback(err.message.replace(/^Error invoking remote method '[^']+': Error: /,'')); }
    }
    openReader(message) {
      this.reader.querySelector('#chat-reader-title').textContent = message.format === 'markdown' ? 'Formatted note' : 'Message';
      const body = this.reader.querySelector('.chat-reader-body'); body.innerHTML = F.html(message.cleartext || message.text, message.format);
      this.readerSize = 100; body.style.fontSize = '100%'; this.reader.querySelector('[data-reader="size"]').textContent = '100%';
      if (!this.reader.open) this.reader.showModal();
    }
    closeReader() { if (this.reader?.open) this.reader.close();this.reader?.querySelector('.chat-reader-body').replaceChildren(); }
    async readerClick(event) {
      const button = event.target.closest('button'); if (!button) return;
      const action = button.dataset.reader;
      if (action === 'close') this.closeReader();
      if (action === 'smaller' || action === 'larger') {
        this.readerSize = Math.max(75, Math.min(180, this.readerSize + (action === 'larger' ? 10 : -10)));
        this.reader.querySelector('.chat-reader-body').style.fontSize = `${this.readerSize}%`;
        this.reader.querySelector('[data-reader="size"]').textContent = `${this.readerSize}%`;
      }
      if (action === 'copy') {
        const text = this.reader.querySelector('.chat-reader-body').innerText;
        const message={text,format:'plain'};
        let copied=this.options.copy ? await this.options.copy({...message,encrypted:true},'plain') : false;
        if(copied===false)copied=await this.copy(message,'plain');
        if(copied!==false)this.feedback('Full text copied.');
        const fallback=this.root.querySelector('.chat-copy-fallback');if(fallback)this.reader.append(fallback);
      }
    }
    async copy(m, mode) {
      const source = (m.cleartext || m.text).replace(/\r/g,'');
      const text = mode === 'source' ? source : F.plain(source,m.format), html = F.html(source,m.format);
      try {
        if (mode === 'formatted' && navigator.clipboard?.write && window.ClipboardItem) { await navigator.clipboard.write([new ClipboardItem({ 'text/plain':new Blob([text],{type:'text/plain'}), 'text/html':new Blob([html],{type:'text/html'}) })]); return true; }
        if (mode !== 'formatted' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
      } catch {}
      // Local HTTP does not expose the modern Clipboard API on phones.
      // Select real DOM content for Safari's user-initiated copy command; leave a manual fallback.
      const box = document.createElement('div'); box.className = 'chat-copy-fallback';
      box.innerHTML = '<p>Select and copy the text below, then close.</p><button type="button">Close</button><div class="chat-copy-content" contenteditable="true" role="textbox" aria-label="Text to copy"></div>';
      const content = box.querySelector('.chat-copy-content');
      if (mode === 'formatted') content.innerHTML = html; else { content.textContent = text; content.classList.add('message-plain'); }
      this.root.append(box); box.querySelector('button').onclick = () => box.remove();
      content.focus(); const selection = getSelection(), range = document.createRange(); range.selectNodeContents(content); selection.removeAllRanges(); selection.addRange(range);
      let copied = false; try { copied = document.execCommand('copy'); } catch {}
      if (copied) { selection.removeAllRanges(); box.remove(); } else this.feedback('Automatic copy is unavailable. Select the text in the copy panel and choose Copy.');
      return copied;
    }
  }
  window.LaneChat = LaneChat;
  LaneChat.clearPrompt='Clear this conversation for both participants?\n\nLane will remove its message history, reactions, drafts and queued text. Offline devices clear their local copies when they reconnect. This cannot be undone in Lane.\n\nSaved notes, clipboard copies, screenshots and external backups remain outside Lane’s control. Secure forensic erasure cannot be guaranteed.';
})();
