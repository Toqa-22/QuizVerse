/* =========================================================
   مؤثرات صوتية بسيطة عبر WebAudio API (بدون ملفات خارجية)
   ========================================================= */

const QVSound = (function(){
  let ctx = null;
  function getCtx(){
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, duration, type = "sine", gainStart = 0.15, delay = 0){
    try{
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainStart, c.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
      osc.connect(gain).connect(c.destination);
      osc.start(c.currentTime + delay);
      osc.stop(c.currentTime + delay + duration + 0.02);
    }catch(e){ /* audio not available, fail silently */ }
  }

  return {
    correct(){ tone(660,0.12,"sine",0.15,0); tone(880,0.18,"sine",0.15,0.1); },
    wrong(){ tone(180,0.28,"sawtooth",0.12,0); },
    click(){ tone(420,0.06,"square",0.06,0); },
    tick(){ tone(1000,0.04,"square",0.04,0); },
    win(){ tone(523,0.14,"sine",0.15,0); tone(659,0.14,"sine",0.15,0.12); tone(784,0.22,"sine",0.15,0.24); },
    start(){ tone(392,0.1,"sine",0.12,0); tone(523,0.14,"sine",0.12,0.1); },
  };
})();
