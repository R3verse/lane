(function () {
  // Resume synchronously inside the gesture. Muted media priming followed by
  // pause() races a subsequent play() on Safari and can consume user activation.
  let context, failure = '';
  function audioContext() {
    if (!context || context.state === 'closed') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser does not provide Web Audio.');
      context = new AudioContext();
    }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    return context;
  }
  function resume() {
    const ctx = audioContext();
    if (ctx.state === 'running') return Promise.resolve(ctx);
    const resumed = ctx.resume(); // Repeat on a new gesture after an iOS interruption.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Audio did not start. Tap Reset audio, then Test sound.')), 2000);
      Promise.resolve(resumed).then(() => { clearTimeout(timer); ctx.state === 'running' ? resolve(ctx) : reject(new Error('Audio is ' + ctx.state + '. Tap Test sound while Lane is visible.')); }, err => { clearTimeout(timer); reject(err); });
    });
  }
  function tone(ctx) {
    const start = ctx.currentTime + .015;
    for (const [offset, frequency] of [[0, 660], [.15, 880]]) {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(.16, start + offset + .015);
      gain.gain.exponentialRampToValueAtTime(.001, start + offset + .20);
      oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.start(start + offset); oscillator.stop(start + offset + .22);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }
  function unlock() {
    if (context?.state === 'running') return Promise.resolve(true);
    try { return resume().then(() => { failure = ''; return true; }, err => { failure = err.message; return false; }); }
    catch (err) { failure = err.message; return Promise.resolve(false); }
  }
  function play() {
    // No awaited priming step before resume(): preserve the click's activation.
    try { return resume().then(ctx => { tone(ctx); failure = ''; return true; }, err => { failure = err.message; return false; }); }
    catch (err) { failure = err.message; return Promise.resolve(false); }
  }
  function reset() {
    const old = context; context = undefined; failure = '';
    if (old && old.state !== 'closed') old.close().catch(() => {});
    return play();
  }
  function status() { return {state:context?.state || 'not activated',error:failure}; }
  // click/keydown retain user activation; pointerdown was too early on touch.
  document.addEventListener('click', () => { void unlock(); }, {passive:true});
  document.addEventListener('keydown', () => { void unlock(); }, {passive:true});
  globalThis.LaneSound = {play, unlock, reset, status};
})();
