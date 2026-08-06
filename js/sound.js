/* =========================================================
   مؤثرات صوتية بسيطة عبر WebAudio API (بدون ملفات خارجية)، مع نظام إعدادات
   صوت كامل (تفعيل/إيقاف المؤثرات، تفعيل/إيقاف الموسيقى الخلفية، ومستوى صوت
   مستقل لكل منهما) محفوظ في localStorage ويُستعاد تلقائيًا عند كل زيارة —
   بغض النظر عن تسجيل الدخول، لأنه إعداد خاص بالمتصفح/الجهاز.
   ========================================================= */

const QVSound = (function(){
  const LS_KEY = "qv_sound_settings";
  const DEFAULTS = { sfxEnabled: true, musicEnabled: false, sfxVolume: 0.7, musicVolume: 0.4 };

  let settings = loadSettings();
  let ctx = null;
  let musicNodes = null; // { oscA, oscB, lfo, gain } عند تشغيل الموسيقى الخلفية

  function loadSettings(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }catch(e){ return { ...DEFAULTS }; }
  }

  function persist(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(settings)); }catch(e){ /* تجاهل أخطاء التخزين */ }
  }

  function getCtx(){
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, duration, type = "sine", gainStart = 0.15, delay = 0){
    if (!settings.sfxEnabled) return;
    try{
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const g = gainStart * settings.sfxVolume;
      gain.gain.setValueAtTime(g, c.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
      osc.connect(gain).connect(c.destination);
      osc.start(c.currentTime + delay);
      osc.stop(c.currentTime + delay + duration + 0.02);
    }catch(e){ /* audio not available, fail silently */ }
  }

  /* ---------------- موسيقى خلفية بسيطة (وسادة صوتية هادئة تتكرر، بلا ملفات خارجية) ---------------- */
  function startMusic(){
    if (!settings.musicEnabled || musicNodes) return;
    try{
      const c = getCtx();
      const gain = c.createGain();
      gain.gain.value = 0.05 * settings.musicVolume;
      gain.connect(c.destination);

      const oscA = c.createOscillator();
      oscA.type = "sine"; oscA.frequency.value = 196; // G3
      const oscB = c.createOscillator();
      oscB.type = "sine"; oscB.frequency.value = 246.94; // B3

      // ذبذبة بطيئة جدًا (LFO) تُحرّك مستوى الصوت بلطف لإحساس "تنفّس" هادئ
      const lfo = c.createOscillator();
      lfo.type = "sine"; lfo.frequency.value = 0.08;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 0.025 * settings.musicVolume;
      lfo.connect(lfoGain).connect(gain.gain);

      oscA.connect(gain); oscB.connect(gain);
      oscA.start(); oscB.start(); lfo.start();
      musicNodes = { oscA, oscB, lfo, gain };
    }catch(e){ /* audio not available */ }
  }

  function stopMusic(){
    if (!musicNodes) return;
    try{
      musicNodes.oscA.stop(); musicNodes.oscB.stop(); musicNodes.lfo.stop();
      musicNodes.oscA.disconnect(); musicNodes.oscB.disconnect(); musicNodes.lfo.disconnect(); musicNodes.gain.disconnect();
    }catch(e){ /* ignore */ }
    musicNodes = null;
  }

  return {
    correct(){ tone(660,0.12,"sine",0.15,0); tone(880,0.18,"sine",0.15,0.1); },
    wrong(){ tone(180,0.28,"sawtooth",0.12,0); },
    click(){ tone(420,0.06,"square",0.06,0); },
    tick(){ tone(1000,0.04,"square",0.04,0); },
    win(){ tone(523,0.14,"sine",0.15,0); tone(659,0.14,"sine",0.15,0.12); tone(784,0.22,"sine",0.15,0.24); },
    start(){ tone(392,0.1,"sine",0.12,0); tone(523,0.14,"sine",0.12,0.1); },

    // ---------------- مؤثرات جديدة (تجربة اللاعب) ----------------
    countdown(){ tone(500,0.16,"sine",0.14,0); },
    go(){ tone(660,0.1,"square",0.16,0); tone(880,0.22,"square",0.16,0.08); },
    timeUp(){ tone(220,0.3,"sawtooth",0.14,0); tone(160,0.35,"sawtooth",0.12,0.15); },
    achievement(){ tone(587,0.12,"sine",0.16,0); tone(740,0.12,"sine",0.16,0.1); tone(880,0.24,"sine",0.16,0.2); },
    levelUp(){ tone(523,0.14,"sine",0.17,0); tone(659,0.14,"sine",0.17,0.12); tone(784,0.14,"sine",0.17,0.24); tone(1047,0.3,"sine",0.18,0.36); },
    coins(){ tone(988,0.07,"square",0.1,0); tone(1319,0.1,"square",0.1,0.06); },
    combo(){ tone(740,0.08,"triangle",0.13,0); tone(988,0.12,"triangle",0.13,0.06); },
    speedBonus(){ tone(880,0.08,"triangle",0.14,0); tone(1175,0.14,"triangle",0.14,0.05); },
    eliminated(){ tone(400,0.12,"sawtooth",0.14,0); tone(260,0.16,"sawtooth",0.13,0.1); tone(140,0.32,"sawtooth",0.12,0.24); },

    // ---------------- إعدادات الصوت ----------------
    getSettings(){ return { ...settings }; },
    setSfxEnabled(v){ settings.sfxEnabled = !!v; persist(); },
    setMusicEnabled(v){
      settings.musicEnabled = !!v; persist();
      if (settings.musicEnabled) startMusic(); else stopMusic();
    },
    setSfxVolume(v){ settings.sfxVolume = Math.max(0, Math.min(1, v)); persist(); },
    setMusicVolume(v){
      settings.musicVolume = Math.max(0, Math.min(1, v)); persist();
      if (musicNodes){
        musicNodes.gain.gain.value = 0.05 * settings.musicVolume;
      }
    },
    startMusic, stopMusic,
  };
})();
