/* =========================================================
   طبقة الاتصال بـ Supabase
   توفر واجهة موحّدة لـ: المصادقة (حسابات اللاعبين)، الملفات
   الشخصية، سجل الألعاب، الإنجازات، الأسئلة، الغرف الجماعية،
   ولوحة المتصدرين — مع رجوع تلقائي لبيانات محلية (Demo Mode)
   عند عدم توفر إعدادات Supabase صحيحة.
   ========================================================= */

const QV = (function(){
  let client = null;
  let demoMode = true;
  let currentSession = null; // { id, username } في الوضع التجريبي أو { user } الحقيقي

  function isConfigured(){
    return QUIZVERSE_CONFIG.SUPABASE_URL.includes("supabase.co") &&
           !QUIZVERSE_CONFIG.SUPABASE_URL.includes("YOUR-PROJECT-REF") &&
           QUIZVERSE_CONFIG.SUPABASE_ANON_KEY &&
           QUIZVERSE_CONFIG.SUPABASE_ANON_KEY !== "YOUR-SUPABASE-ANON-PUBLIC-KEY";
  }

  function init(){
    if (isConfigured() && window.supabase){
      try{
        client = window.supabase.createClient(QUIZVERSE_CONFIG.SUPABASE_URL, QUIZVERSE_CONFIG.SUPABASE_ANON_KEY, {
          realtime: { params: { eventsPerSecond: 10 } }
        });
        demoMode = false;
      }catch(e){
        console.warn("تعذّر تهيئة Supabase، سيتم استخدام الوضع التجريبي المحلي.", e);
        demoMode = true;
      }
    } else {
      demoMode = true;
    }
    return { demoMode };
  }

  /* ---------------- local demo storage (localStorage) ---------------- */
  const LS_KEYS = {
    questions: "qv_demo_questions",
    accounts: "qv_demo_accounts",     // username(lowercase) -> { id, username, passwordHash }
    profiles: "qv_demo_profiles",     // id -> profile object
    session: "qv_demo_session",       // { id, username }
    history: "qv_demo_history",       // array of game_history rows
    games: "qv_demo_games",
    players: "qv_demo_players",
    settings: "qv_demo_settings",     // { category: questionCount }
    quizSettings: "qv_demo_quiz_settings", // { shuffleQuestions, shuffleAnswers, preventRepetition, randomGeneration }
    timers: "qv_demo_category_timers", // { category: seconds }
    ageTimers: "qv_demo_age_timers",   // [{ id, min_age, max_age, time_seconds }]
    typeTimers: "qv_demo_type_timers", // { multiple_choice: seconds, true_false: seconds, matching: seconds, ordering: seconds }
    adminAccounts: "qv_demo_admin_accounts", // username(lowercase) -> { username, passwordHash } — نفس آلية bootstrap
    subAdmins: "qv_demo_sub_admins",  // username(lowercase) -> { id, username, passwordHash, active, created_at }
    activityLog: "qv_demo_activity_log", // مصفوفة بأحدث العمليات أولًا
  };

  function lsGet(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(e){ return fallback; }
  }
  function lsSet(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){/* ignore quota errors */}
  }

  function ensureDemoQuestions(){
    let q = lsGet(LS_KEYS.questions, null);
    if (!q){
      // كل سؤال بلا نوع محدد (كل الأسئلة القديمة الحالية) يُعامَل تلقائيًا
      // كسؤال "اختيار من متعدد" — لا تغيير في سلوكها إطلاقًا. وبالمثل، كل
      // سؤال بلا حالة محددة يُعامَل كسؤال "مقبول" (approved) — تمامًا كسلوك
      // كل الأسئلة الحالية قبل إضافة نظام "اقتراحات اللاعبين"
      q = DEMO_QUESTIONS.map((item, i) => ({ id: "demo-" + i, ...item, type: item.type || "multiple_choice", status: item.status || "approved" }));
      lsSet(LS_KEYS.questions, q);
    }
    return q;
  }

  /* بصمة بسيطة غير تشفيرية لكلمة المرور — تكفي للوضع التجريبي المحلي فقط.
     في الإنتاج الفعلي، تشفير كلمات المرور تتولاه Supabase Auth بالكامل. */
  function simpleHash(str){
    let h = 5381;
    for (let i = 0; i < str.length; i++){ h = ((h << 5) + h) + str.charCodeAt(i); h |= 0; }
    return "h" + Math.abs(h).toString(36);
  }

  function newId(prefix){ return prefix + "-" + Date.now() + "-" + Math.floor(Math.random()*1e5); }

  function defaultProfile({ id, username, age, avatar }){
    return {
      id, username, avatar: avatar || QUIZVERSE_AVATARS[0], age,
      total_score: 0, level: "مبتدئ", games_played: 0, correct_answers: 0,
      wrong_answers: 0, total_questions_answered: 0,
      streak: 0, last_played_date: null, favorite_category: null,
      achievements: [], completed_combos: [], replay_grants: {}, room_rejoin_grants: {},
      recent_questions: {},  // "فئة:مستوى" -> [معرّفات أسئلة أُجيب عنها مؤخرًا] لمنع التكرار
      created_at: new Date().toISOString(),
    };
  }

  /* ================= AUTH (اسم مستخدم وكلمة مرور فقط — بدون بريد إلكتروني إطلاقًا) =================
     في الوضع التجريبي: الحسابات في localStorage.
     في وضع Supabase الحقيقي: لا نستخدم Supabase Auth نهائيًا (الذي يتطلب بريدًا)؛ بل نستدعي
     دالتي RPC آمنتين register_player / verify_login (راجع sql/schema.sql) تتحققان من اسم
     المستخدم وكلمة المرور مباشرة في جدول player_accounts المحمي (غير قابل للقراءة من العميل)،
     وتُعيدان فقط معرّف الحساب دون كشف كلمة المرور المشفّرة لأي طرف. */
  async function signUp({ username, password, age, avatar }){
    username = (username || "").trim();
    if (!username || !password) throw new Error("الرجاء تعبئة جميع الحقول");
    if (username.length < 3) throw new Error("اسم المستخدم قصير جدًا (3 أحرف على الأقل)");
    if (!/^[a-zA-Z0-9_\u0600-\u06FF]+$/.test(username)) throw new Error("اسم المستخدم يجب أن يحتوي أحرفًا وأرقامًا فقط");
    if (password.length < 6) throw new Error("كلمة المرور يجب ألا تقل عن 6 أحرف");

    const passwordHash = simpleHash(password);
    let id;

    if (demoMode){
      const accounts = lsGet(LS_KEYS.accounts, {});
      const key = username.toLowerCase();
      if (accounts[key]) throw new Error("اسم المستخدم مستخدم بالفعل، جرّب اسمًا آخر");
      id = newId("user");
      accounts[key] = { id, username, passwordHash };
      lsSet(LS_KEYS.accounts, accounts);
    } else {
      const { data, error } = await client.rpc("register_player", { p_username: username, p_password_hash: passwordHash });
      if (error) throw new Error(/مستخدم/.test(error.message) ? "اسم المستخدم مستخدم بالفعل، جرّب اسمًا آخر" : error.message);
      id = data;
    }

    const profile = defaultProfile({ id, username, age, avatar });
    if (demoMode){
      const profiles = lsGet(LS_KEYS.profiles, {});
      profiles[id] = profile;
      lsSet(LS_KEYS.profiles, profiles);
    } else {
      const { error: insertErr } = await client.from("profiles").insert(profile);
      if (insertErr) throw insertErr;
    }

    currentSession = { id, username };
    lsSet(LS_KEYS.session, currentSession);
    return profile;
  }

  async function signIn({ username, password }){
    username = (username || "").trim();
    const passwordHash = simpleHash(password);
    let id;

    if (demoMode){
      const accounts = lsGet(LS_KEYS.accounts, {});
      const acc = accounts[username.toLowerCase()];
      if (!acc || acc.passwordHash !== passwordHash) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
      id = acc.id;
    } else {
      const { data, error } = await client.rpc("verify_login", { p_username: username, p_password_hash: passwordHash });
      if (error || !data) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
      id = data;
    }

    currentSession = { id, username };
    lsSet(LS_KEYS.session, currentSession);
    return getProfile(id);
  }

  async function signOut(){
    currentSession = null;
    localStorage.removeItem(LS_KEYS.session);
  }

  async function restoreSession(){
    const saved = lsGet(LS_KEYS.session, null);
    if (!saved) return null;
    currentSession = saved;
    return getProfile(saved.id);
  }

  function getCurrentUserId(){
    return currentSession ? currentSession.id : null;
  }

  async function changePassword(newPassword){
    if (newPassword.length < 6) throw new Error("كلمة المرور يجب ألا تقل عن 6 أحرف");
    if (!currentSession) throw new Error("الرجاء تسجيل الدخول أولًا");
    const passwordHash = simpleHash(newPassword);

    if (demoMode){
      const accounts = lsGet(LS_KEYS.accounts, {});
      const key = currentSession.username.toLowerCase();
      if (!accounts[key]) throw new Error("تعذّر إيجاد الحساب");
      accounts[key].passwordHash = passwordHash;
      lsSet(LS_KEYS.accounts, accounts);
      return true;
    }
    const { error } = await client.rpc("set_player_password", { p_id: currentSession.id, p_new_hash: passwordHash });
    if (error) throw error;
    return true;
  }

  /* ================= PROFILES ================= */
  async function getProfile(userId){
    if (demoMode){
      const profiles = lsGet(LS_KEYS.profiles, {});
      return profiles[userId] || null;
    }
    const { data, error } = await client.from("profiles").select("*").eq("id", userId).single();
    if (error){ console.error(error); return null; }
    return data;
  }

  /* الفئة العمرية تُقفَل بعد إنشاء الحساب — نفس القاعدة مطبَّقة هنا في
     الوضع التجريبي المحلي، ومن جهة الخادم عبر trigger على قاعدة
     Supabase الحقيقية (راجع prevent_age_change في sql/schema.sql)،
     حتى لا تعتمد الحماية على إخفاء الحقل في الواجهة فقط. */
  async function updateProfile(userId, patch){
    if (demoMode){
      const profiles = lsGet(LS_KEYS.profiles, {});
      if (!profiles[userId]) throw new Error("الملف الشخصي غير موجود");
      if (patch.age !== undefined && patch.age !== profiles[userId].age){
        throw new Error("لا يمكن تغيير الفئة العمرية بعد إنشاء الحساب");
      }
      profiles[userId] = { ...profiles[userId], ...patch };
      lsSet(LS_KEYS.profiles, profiles);
      return profiles[userId];
    }
    const { data, error } = await client.from("profiles").update(patch).eq("id", userId).select().single();
    if (error) throw error;
    return data;
  }

  async function listAllProfiles(){
    if (demoMode){
      const profiles = lsGet(LS_KEYS.profiles, {});
      return Object.values(profiles);
    }
    const { data, error } = await client.from("profiles").select("*");
    if (error){ console.error(error); return []; }
    return data;
  }

  async function getRank(userId){
    const all = await listAllProfiles();
    const sorted = all.slice().sort((a,b) => (b.total_score||0) - (a.total_score||0));
    const idx = sorted.findIndex(p => p.id === userId);
    return idx === -1 ? null : idx + 1;
  }

  /* ================= GAME HISTORY ================= */
  async function addGameHistory(entry){
    const row = { id: newId("hist"), played_at: new Date().toISOString(), ...entry };
    if (demoMode){
      const hist = lsGet(LS_KEYS.history, []);
      hist.unshift(row);
      lsSet(LS_KEYS.history, hist);
      return row;
    }
    const { data, error } = await client.from("game_history").insert(entry).select().single();
    if (error) throw error;
    return data;
  }

  async function getGameHistory(userId, limit = 8){
    if (demoMode){
      const hist = lsGet(LS_KEYS.history, []);
      return hist.filter(h => h.user_id === userId).slice(0, limit);
    }
    const { data, error } = await client.from("game_history").select("*").eq("user_id", userId).order("played_at", { ascending: false }).limit(limit);
    if (error){ console.error(error); return []; }
    return data;
  }

  async function getAllHistory(){
    if (demoMode) return lsGet(LS_KEYS.history, []);
    const { data, error } = await client.from("game_history").select("*");
    if (error){ console.error(error); return []; }
    return data;
  }

  /* ================= ACHIEVEMENTS ================= */
  function computeAchievements(profile, rank){
    return QUIZVERSE_ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked: a.check(profile, rank),
    }));
  }

  async function syncAchievements(profile, rank){
    const computed = computeAchievements(profile, rank);
    const unlockedIds = computed.filter(a => a.unlocked).map(a => a.id);
    const prevIds = profile.achievements || [];
    const newlyUnlocked = unlockedIds.filter(id => !prevIds.includes(id));
    if (unlockedIds.length !== prevIds.length){
      await updateProfile(profile.id, { achievements: unlockedIds });
      profile.achievements = unlockedIds;
    }
    return { computed, newlyUnlocked };
  }

  /* ================= QUIZ RESULT SUBMISSION ================= */
  async function submitQuizResult({ userId, result, gameId }){
    const profile = await getProfile(userId);
    if (!profile) throw new Error("الرجاء تسجيل الدخول أولًا");

    const today = new Date().toISOString().slice(0, 10);
    let streak = profile.streak || 0;
    if (profile.last_played_date){
      const last = new Date(profile.last_played_date);
      const diffDays = Math.round((new Date(today) - new Date(last.toISOString().slice(0,10))) / 86400000);
      if (diffDays === 1) streak += 1;
      else if (diffDays > 1) streak = 1;
      // diffDays === 0 (same day) -> streak unchanged
    } else {
      streak = 1;
    }

    const patch = {
      total_score: (profile.total_score || 0) + result.score,
      games_played: (profile.games_played || 0) + 1,
      correct_answers: (profile.correct_answers || 0) + result.correctCount,
      wrong_answers: (profile.wrong_answers || 0) + result.wrongCount,
      total_questions_answered: (profile.total_questions_answered || 0) + result.total,
      streak,
      last_played_date: today,
      favorite_category: result.category || profile.favorite_category,
      level: levelForScore((profile.total_score || 0) + result.score).name,
    };

    // تتبّع فئة+مستوى مكتملة، واستهلاك محاولة إضافية إن كانت ممنوحة من المشرف،
    // وتسجيل أسئلة هذا الاختبار كـ"حديثة" لمنع تكرارها في المرة القادمة
    if (result.difficulty){
      const comboKey = result.category + ":" + result.difficulty;
      const completed = (profile.completed_combos || []).slice();
      const grants = { ...(profile.replay_grants || {}) };
      if (completed.includes(comboKey)){
        if (grants[comboKey] > 0) grants[comboKey] -= 1;
      } else {
        completed.push(comboKey);
      }
      patch.completed_combos = completed;
      patch.replay_grants = grants;

      if (result.questionIds && result.questionIds.length){
        const recent = { ...(profile.recent_questions || {}) };
        const prevIds = recent[comboKey] || [];
        const merged = prevIds.concat(result.questionIds);
        recent[comboKey] = merged.slice(-60); // نحتفظ بآخر 60 معرّفًا فقط لكل تركيبة
        patch.recent_questions = recent;
      }
    }

    // في الوضع الجماعي: تسجيل استهلاك "إذن إعادة انضمام" إن كان اللاعب قد أكمل
    // هذه الغرفة تحديدًا من قبل (يُمنح هذا الإذن فقط من المشرف — راجع
    // grantRoomRejoin أدناه). أول إكمال لأي غرفة يمر دون أي قيد كالمعتاد.
    if (gameId){
      const alreadyPlayedRoom = await hasPlayedGame(userId, gameId);
      if (alreadyPlayedRoom){
        const roomGrants = { ...(profile.room_rejoin_grants || {}) };
        if (roomGrants[gameId] > 0) roomGrants[gameId] -= 1;
        patch.room_rejoin_grants = roomGrants;
      }
    }

    const updated = await updateProfile(userId, patch);

    await addGameHistory({
      user_id: userId, game_id: gameId || null, category: result.category,
      score: result.score, correct_count: result.correctCount, total: result.total,
    });

    const rank = await getRank(userId);
    const { newlyUnlocked } = await syncAchievements(updated, rank);

    return { profile: updated, rank, newlyUnlocked };
  }

  /* ================= PLAY RESTRICTIONS (مرة واحدة لكل فئة+مستوى) ================= */
  function canPlay(profile, category, difficulty){
    if (!profile || !category || !difficulty) return true;
    const key = category + ":" + difficulty;
    const completed = profile.completed_combos || [];
    if (!completed.includes(key)) return true;
    const grants = profile.replay_grants || {};
    return (grants[key] || 0) > 0;
  }

  async function grantReplay(userId, category, difficulty){
    const profile = await getProfile(userId);
    if (!profile) throw new Error("اللاعب غير موجود");
    const key = category + ":" + difficulty;
    const grants = { ...(profile.replay_grants || {}) };
    grants[key] = (grants[key] || 0) + 1;
    return updateProfile(userId, { replay_grants: grants });
  }

  /* ================= ROOM JOIN RESTRICTIONS (مرة واحدة لكل غرفة جماعية) =================
     يُسمح للاعب بإكمال أي غرفة جماعية مرة واحدة فقط. محاولة الانضمام مجددًا
     لغرفة سبق أن أكملها تُرفض، إلا إذا منحه المشرف إذن إعادة انضمام صريحًا
     لتلك الغرفة تحديدًا (يُستهلك تلقائيًا عند إكمالها مرة أخرى). */
  async function hasPlayedGame(userId, gameId){
    if (!userId || !gameId) return false;
    if (demoMode){
      const hist = lsGet(LS_KEYS.history, []);
      return hist.some(h => h.user_id === userId && h.game_id === gameId);
    }
    const { data, error } = await client.from("game_history").select("id").eq("user_id", userId).eq("game_id", gameId).limit(1);
    if (error){ console.error(error); return false; }
    return (data || []).length > 0;
  }

  async function canJoinRoom(profile, gameId){
    if (!profile || !gameId) return true;
    const played = await hasPlayedGame(profile.id, gameId);
    if (!played) return true;
    const grants = profile.room_rejoin_grants || {};
    return (grants[gameId] || 0) > 0;
  }

  async function grantRoomRejoin(userId, gameId){
    const profile = await getProfile(userId);
    if (!profile) throw new Error("اللاعب غير موجود");
    const grants = { ...(profile.room_rejoin_grants || {}) };
    grants[gameId] = (grants[gameId] || 0) + 1;
    return updateProfile(userId, { room_rejoin_grants: grants });
  }

  async function grantRoomRejoinByUsername(username, gameId){
    const profiles = await listAllProfiles();
    const target = (username || "").trim().toLowerCase();
    const profile = profiles.find(p => (p.username || "").toLowerCase() === target);
    if (!profile) throw new Error("لم يتم العثور على لاعب بهذا الاسم");
    return grantRoomRejoin(profile.id, gameId);
  }

  /* ================= QUESTION-COUNT SETTINGS (لكل فئة) ================= */
  async function getQuestionCounts(){
    if (demoMode) return lsGet(LS_KEYS.settings, {});
    const { data, error } = await client.from("app_settings").select("value").eq("key", "question_counts").maybeSingle();
    if (error || !data) return {};
    return data.value || {};
  }

  async function saveQuestionCounts(counts){
    if (demoMode){ lsSet(LS_KEYS.settings, counts); return counts; }
    const { error } = await client.from("app_settings").upsert({ key: "question_counts", value: counts });
    if (error) throw error;
    return counts;
  }

  /* ================= CATEGORY TIMER SETTINGS (مؤقت مستقل لكل فئة، بالثواني) ================= */
  async function getCategoryTimers(){
    if (demoMode) return lsGet(LS_KEYS.timers, {});
    const { data, error } = await client.from("app_settings").select("value").eq("key", "category_timers").maybeSingle();
    if (error || !data) return {};
    return data.value || {};
  }

  async function saveCategoryTimers(timers){
    // نضمن أن كل قيمة ثانية صحيحة >= 1 قبل الحفظ (لا صفر ولا أرقام سالبة)
    const clean = {};
    Object.entries(timers || {}).forEach(([cat, secs]) => {
      const n = Math.floor(Number(secs));
      clean[cat] = Number.isFinite(n) && n >= 1 ? n : QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION;
    });
    if (demoMode){ lsSet(LS_KEYS.timers, clean); return clean; }
    const { error } = await client.from("app_settings").upsert({ key: "category_timers", value: clean });
    if (error) throw error;
    return clean;
  }

  /* ================= QUESTION-TYPE TIMER SETTINGS (مؤقت مستقل لكل نوع سؤال، بالثواني) =================
     له الأولوية القصوى عند تطبيق المؤقت على أي سؤال بعينه (راجع quiz-engine.js)، لأن كل
     نوع سؤال يختلف في طبيعة التفاعل معه (صح/خطأ أسرع من الترتيب أو المطابقة مثلاً). */
  const DEFAULT_TYPE_TIMERS = {
    multiple_choice: QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION,
    true_false: QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION,
    matching: QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION,
    ordering: QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION,
  };

  async function getQuestionTypeTimers(){
    if (demoMode) return { ...DEFAULT_TYPE_TIMERS, ...lsGet(LS_KEYS.typeTimers, {}) };
    const { data, error } = await client.from("app_settings").select("value").eq("key", "type_timers").maybeSingle();
    if (error || !data) return { ...DEFAULT_TYPE_TIMERS };
    return { ...DEFAULT_TYPE_TIMERS, ...(data.value || {}) };
  }

  async function saveQuestionTypeTimers(timers){
    const clean = {};
    Object.entries(timers || {}).forEach(([type, secs]) => {
      const n = Math.floor(Number(secs));
      clean[type] = Number.isFinite(n) && n >= 1 ? n : QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION;
    });
    if (demoMode){ lsSet(LS_KEYS.typeTimers, clean); return clean; }
    const { error } = await client.from("app_settings").upsert({ key: "type_timers", value: clean });
    if (error) throw error;
    return clean;
  }

  /* ================= AGE-BASED TIMER SETTINGS (مؤقت الأسئلة حسب الفئة العمرية) =================
     له أولوية على مؤقت الفئة المعرفية عند وجود فئة عمرية مطابقة لعمر اللاعب —
     راجع resolveQuestionTimer أدناه لمنطق الأولوية الكامل. */
  async function getAgeTimerSettings(){
    if (demoMode){
      return lsGet(LS_KEYS.ageTimers, []).slice().sort((a, b) => a.min_age - b.min_age);
    }
    const { data, error } = await client.from("quiz_timer_settings").select("*").order("min_age", { ascending: true });
    if (error){ console.error(error); return []; }
    return data || [];
  }

  async function saveAgeTimerSetting(setting){
    const clean = {
      id: setting.id || undefined,
      min_age: Math.max(0, Math.floor(Number(setting.min_age) || 0)),
      max_age: Math.max(0, Math.floor(Number(setting.max_age) || 0)),
      time_seconds: Math.max(1, Math.floor(Number(setting.time_seconds) || QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION)),
    };
    if (clean.min_age > clean.max_age){
      throw new Error("العمر الأدنى يجب أن يكون أقل من أو يساوي العمر الأقصى");
    }

    if (demoMode){
      const all = lsGet(LS_KEYS.ageTimers, []);
      if (clean.id){
        const updated = all.map(s => s.id === clean.id ? { ...s, ...clean } : s);
        lsSet(LS_KEYS.ageTimers, updated);
        return clean;
      }
      clean.id = "agetimer-" + Date.now();
      all.push(clean);
      lsSet(LS_KEYS.ageTimers, all);
      return clean;
    }

    if (clean.id){
      const { data, error } = await client.from("quiz_timer_settings")
        .update({ min_age: clean.min_age, max_age: clean.max_age, time_seconds: clean.time_seconds, updated_at: new Date().toISOString() })
        .eq("id", clean.id).select().single();
      if (error) throw error;
      return data;
    }
    delete clean.id;
    const { data, error } = await client.from("quiz_timer_settings").insert(clean).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteAgeTimerSetting(id){
    if (demoMode){
      const all = lsGet(LS_KEYS.ageTimers, []).filter(s => s.id !== id);
      lsSet(LS_KEYS.ageTimers, all);
      return true;
    }
    const { error } = await client.from("quiz_timer_settings").delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  /* يحسم مؤقت السؤال النهائي لهذا اللاعب بحسب الأولوية التالية:
     1) فئة عمرية مطابقة لعمر اللاعب في quiz_timer_settings (إن وُجدت)
     2) مؤقت الفئة المعرفية المُعدّ من قبل المشرف (category_timers)
     3) القيمة الافتراضية العامة في js/config.js */
  async function resolveQuestionTimer({ age, category } = {}){
    if (age != null){
      const ageSettings = await getAgeTimerSettings();
      const match = ageSettings.find(s => age >= s.min_age && age <= s.max_age);
      if (match) return match.time_seconds;
    }
    if (category){
      const categoryTimers = await getCategoryTimers();
      if (categoryTimers[category]) return categoryTimers[category];
    }
    return QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION;
  }

  /* ================= QUIZ BEHAVIOR SETTINGS (تحكم المشرف بالعشوائية) ================= */
  const DEFAULT_QUIZ_SETTINGS = {
    shuffleQuestions: true,     // خلط ترتيب الأسئلة المختارة لكل اختبار
    shuffleAnswers: true,       // خلط ترتيب الخيارات الأربعة في كل عرض للسؤال
    preventRepetition: true,    // تجنّب الأسئلة التي أُجيب عنها مؤخرًا كلما توفر عدد كافٍ
    randomGeneration: true,     // المفتاح الرئيسي: عند إيقافه يصبح كل اختبار ثابتًا للجميع
  };

  async function getQuizSettings(){
    if (demoMode) return { ...DEFAULT_QUIZ_SETTINGS, ...lsGet(LS_KEYS.quizSettings, {}) };
    const { data, error } = await client.from("app_settings").select("value").eq("key", "quiz_settings").maybeSingle();
    if (error || !data) return { ...DEFAULT_QUIZ_SETTINGS };
    return { ...DEFAULT_QUIZ_SETTINGS, ...(data.value || {}) };
  }

  async function saveQuizSettings(settings){
    const merged = { ...DEFAULT_QUIZ_SETTINGS, ...settings };
    if (demoMode){ lsSet(LS_KEYS.quizSettings, merged); return merged; }
    const { error } = await client.from("app_settings").upsert({ key: "quiz_settings", value: merged });
    if (error) throw error;
    return merged;
  }

  /* ================= QUESTIONS =================
     امتدت الدالة لدعم "إعدادات العشوائية الخاصة بكل غرفة" (راجع ميزة #8): تصفية
     بمعرّف غرفة محدد (roomId) بدلًا من الفئة، تقييد أنواع الأسئلة المسموحة
     (allowedTypes)، توزيع نسب الصعوبة (difficultyDistribution)، وتجاوز مؤقت
     لإعدادات العشوائية العامة (settingsOverride) — كل ذلك اختياري تمامًا، وأي
     استدعاء بالطريقة القديمة (بدون هذه المعاملات) يعمل بالضبط كما كان من قبل. */
  async function fetchQuestionPool({ category, roomId, difficulty, ageMin, ageMax, allowedTypes }){
    let all;
    if (demoMode){
      all = ensureDemoQuestions();
      if (roomId) all = all.filter(q => q.room_id === roomId);
      else if (category) all = all.filter(q => q.category === category);
      if (difficulty) all = all.filter(q => q.difficulty === difficulty);
      if (ageMin != null) all = all.filter(q => q.age_max >= ageMin);
      if (ageMax != null) all = all.filter(q => q.age_min <= ageMax);
    } else {
      // نُصفّي الفئة/الغرفة/المستوى/العمر مباشرة عبر الاستعلام قبل الجلب لتبقى
      // الاستعلامات سريعة حتى مع آلاف الأسئلة، ثم نطبّق الخلط/الاستبعاد لاحقًا
      let query = client.from("questions").select("*");
      if (roomId) query = query.eq("room_id", roomId);
      else if (category) query = query.eq("category", category);
      if (difficulty) query = query.eq("difficulty", difficulty);
      if (ageMin != null) query = query.gte("age_max", ageMin);
      if (ageMax != null) query = query.lte("age_min", ageMax);
      const { data, error } = await query;
      if (error){ console.error(error); return []; }
      all = data || [];
    }
    if (allowedTypes && allowedTypes.length){
      all = all.filter(q => allowedTypes.includes(q.type || "multiple_choice"));
    }
    // الأسئلة التي اقترحها لاعبون ولم يوافق عليها المشرف بعد (status === "pending")
    // تبقى مستبعدة تمامًا من أي بنك أسئلة فعلي (اختبار فردي، غرفة جماعية، أو
    // حتى قائمة "الأسئلة" في لوحة التحكم) — تظهر فقط في لوحة "اقتراحات اللاعبين"
    // المخصصة عبر getQuestionSuggestions أدناه، حتى تتم الموافقة عليها
    all = all.filter(q => (q.status || "approved") !== "pending");
    return all;
  }

  /* اقتراحات الأسئلة التي أرسلها اللاعبون بانتظار مراجعة المشرف/المشرف الفرعي */
  async function getQuestionSuggestions(){
    if (demoMode){
      return ensureDemoQuestions().filter(q => q.status === "pending");
    }
    const { data, error } = await client.from("questions").select("*").eq("status", "pending");
    if (error){ console.error(error); return []; }
    return data || [];
  }

  /* قبول اقتراح كما هو دون أي تعديل — يتحوّل فورًا لسؤال فعلي ضمن بنك الأسئلة */
  function approveQuestionSuggestion(id){
    return saveQuestion({ id, status: "approved" });
  }

  async function getQuestions({ category, ageMin, ageMax, difficulty, limit, excludeIds, roomId, allowedTypes, difficultyDistribution, settingsOverride } = {}){
    const settings = { ...(await getQuizSettings()), ...(settingsOverride || {}) };

    let all;
    if (difficultyDistribution && limit){
      // توزيع الأسئلة حسب نسب الصعوبة المحددة لهذه الغرفة (سهل/متوسط/صعب)
      const diffs = ["easy", "medium", "hard"];
      const totalPct = diffs.reduce((s, d) => s + (Number(difficultyDistribution[d]) || 0), 0);
      if (totalPct > 0){
        const parts = [];
        let allocated = 0;
        for (let i = 0; i < diffs.length; i++){
          const d = diffs[i];
          const pct = Number(difficultyDistribution[d]) || 0;
          if (pct <= 0) continue;
          const isLast = i === diffs.length - 1 || diffs.slice(i + 1).every(dd => !(Number(difficultyDistribution[dd]) > 0));
          const count = isLast ? Math.max(0, limit - allocated) : Math.round(limit * pct / totalPct);
          allocated += count;
          if (count > 0){
            const pool = shuffle((await fetchQuestionPool({ category, roomId, difficulty: d, ageMin, ageMax, allowedTypes })).slice());
            parts.push(...pool.slice(0, count));
          }
        }
        all = parts;
      } else {
        all = await fetchQuestionPool({ category, roomId, difficulty, ageMin, ageMax, allowedTypes });
      }
    } else {
      all = await fetchQuestionPool({ category, roomId, difficulty, ageMin, ageMax, allowedTypes });
    }

    if (!settings.randomGeneration){
      // وضع ثابت غير عشوائي بالكامل: نفس الترتيب لكل اللاعبين، بدون استبعاد أسئلة سابقة
      return limit ? all.slice(0, limit) : all;
    }

    // منع تكرار الأسئلة المُجابة مؤخرًا — فقط إن بقي عدد كافٍ من الأسئلة لتلبية الطلب
    if (settings.preventRepetition && excludeIds && excludeIds.length){
      const filtered = all.filter(q => !excludeIds.includes(q.id));
      if (filtered.length >= (limit || 1)) all = filtered;
    }

    if (settings.shuffleQuestions) all = shuffle(all.slice());

    return limit ? all.slice(0, limit) : all;
  }

  async function saveQuestion(q){
    if (demoMode){
      let all = ensureDemoQuestions();
      if (q.id){
        all = all.map(item => item.id === q.id ? { ...item, ...q } : item);
      } else {
        q.id = "demo-" + Date.now();
        all.push(q);
      }
      lsSet(LS_KEYS.questions, all);
      return q;
    }
    if (q.id && !String(q.id).startsWith("demo-")){
      const { data, error } = await client.from("questions").update(q).eq("id", q.id).select().single();
      if (error) throw error;
      return data;
    }
    delete q.id;
    const { data, error } = await client.from("questions").insert(q).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteQuestion(id){
    if (demoMode){
      let all = ensureDemoQuestions().filter(q => q.id !== id);
      lsSet(LS_KEYS.questions, all);
      return true;
    }
    const { error } = await client.from("questions").delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  /* ================= LEADERBOARD ================= */
  /* لوحة المتصدرين العالمية: كل اللاعبين مرتّبين تنازليًا حسب إجمالي النقاط.
     تُعاد القائمة كاملة (غير مقصوصة) ليتمكن الاستدعاء من حساب ترتيب اللاعب
     الحالي بدقة حتى لو لم يكن ضمن أعلى اللاعبين المعروضين في الواجهة. */
  async function getLeaderboard(){
    const profiles = await listAllProfiles();
    return profiles
      .slice()
      .sort((a, b) => (b.total_score || 0) - (a.total_score || 0))
      .map((p, i) => ({ ...p, rank: i + 1 }));
  }

  /* ================= GAMES (multiplayer) ================= */
  async function getGames(){
    if (demoMode) return lsGet(LS_KEYS.games, []);
    const { data, error } = await client.from("games").select("*").order("start_time", { ascending: true });
    if (error){ console.error(error); return []; }
    return data;
  }

  async function saveGame(g){
    if (demoMode){
      let all = lsGet(LS_KEYS.games, []);
      if (g.id){
        all = all.map(item => item.id === g.id ? { ...item, ...g } : item);
      } else {
        g.id = "game-" + Date.now();
        g.status = g.status || "waiting";
        all.push(g);
      }
      lsSet(LS_KEYS.games, all);
      return g;
    }
    if (g.id){
      const { data, error } = await client.from("games").update(g).eq("id", g.id).select().single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await client.from("games").insert(g).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteGame(id){
    if (demoMode){
      let all = lsGet(LS_KEYS.games, []).filter(g => g.id !== id);
      lsSet(LS_KEYS.games, all);
      const players = lsGet(LS_KEYS.players, {});
      delete players[id];
      lsSet(LS_KEYS.players, players);
      return true;
    }
    const { error } = await client.from("games").delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  async function joinGame(gameId, player){
    if (demoMode){
      const players = lsGet(LS_KEYS.players, {});
      players[gameId] = players[gameId] || [];
      players[gameId].push(player);
      lsSet(LS_KEYS.players, players);
      return players[gameId];
    }
    const { data, error } = await client.from("game_players").insert({ game_id: gameId, ...player }).select();
    if (error) throw error;
    return data;
  }

  async function getGamePlayers(gameId){
    if (demoMode){
      const players = lsGet(LS_KEYS.players, {});
      return players[gameId] || [];
    }
    const { data, error } = await client.from("game_players").select("*").eq("game_id", gameId);
    if (error){ console.error(error); return []; }
    return data;
  }

  /* إزالة لاعب من غرفة جماعية (يستخدمها المشرف الرئيسي أو المشرف الفرعي مالك
     الغرفة من لوحة "الغرف الجماعية" ← "👥 اللاعبون") — يُخرج اللاعب من هذه
     الغرفة تحديدًا فقط، ولا يمسّ حسابه أو نتائجه في أي غرفة أو اختبار آخر */
  async function removeGamePlayer(gameId, userId){
    if (demoMode){
      const players = lsGet(LS_KEYS.players, {});
      players[gameId] = (players[gameId] || []).filter(p => p.user_id !== userId);
      lsSet(LS_KEYS.players, players);
      return true;
    }
    const { error } = await client.from("game_players").delete().eq("game_id", gameId).eq("user_id", userId);
    if (error) throw error;
    return true;
  }

  /* يُحدَّث بعد كل اختبار جماعي لتنعكس نتيجة اللاعب فورًا في ترتيب الغرفة
     (أفضل 3 لاعبين داخل الغرفة، وشاشة "ترتيب الغرف" العامة) */
  /* يُحدَّث بعد كل اختبار جماعي — يسجّل وقت أول إتمام (finished_at) مرة واحدة
     فقط حتى لو استُدعيت الدالة لاحقًا لإضافة مكافأة (لا تتغيّر لحظة "الوصول"
     الفعلية للاعب، وهذا أساس حساب ترتيب الفائزين الثلاثة الأوائل). */
  async function updateGamePlayerScore(gameId, userId, score){
    if (demoMode){
      const players = lsGet(LS_KEYS.players, {});
      const list = players[gameId] || [];
      const idx = list.findIndex(p => p.user_id === userId);
      if (idx !== -1){
        const finishedAt = list[idx].finished_at || new Date().toISOString();
        list[idx] = { ...list[idx], score, finished_at: finishedAt };
        players[gameId] = list;
        lsSet(LS_KEYS.players, players);
      }
      return true;
    }
    const { data: existing } = await client.from("game_players").select("finished_at").eq("game_id", gameId).eq("user_id", userId).maybeSingle();
    const patch = { score };
    if (!existing || !existing.finished_at) patch.finished_at = new Date().toISOString();
    const { error } = await client.from("game_players").update(patch).eq("game_id", gameId).eq("user_id", userId);
    if (error) throw error;
    return true;
  }

  /* ================= LIVE PLAY: مكافأة الترتيب لأول 3 فائزين في الغرفة =================
     تُحسب فور إتمام اللاعب اختباره، بناءً على ترتيبه الزمني الفعلي بين كل من
     أكملوا هذه الغرفة حتى الآن (finished_at). لا حاجة لانتظار انتهاء الغرفة —
     كل لاعب يعرف مكافأته لحظة إتمامه هو تحديدًا (يتوافق مع مبدأ "اللعب المباشر"). */
  const ROOM_PLACEMENT_BONUS = { 1: 50, 2: 30, 3: 15 };

  async function awardRoomPlacementBonus(gameId, userId){
    const players = await getGamePlayers(gameId);
    const finished = players
      .filter(p => p.finished_at)
      .sort((a, b) => new Date(a.finished_at) - new Date(b.finished_at));
    const rank = finished.findIndex(p => p.user_id === userId) + 1;
    const bonus = ROOM_PLACEMENT_BONUS[rank] || 0;
    if (bonus <= 0) return 0;

    const profile = await getProfile(userId);
    if (!profile) return 0;
    await updateProfile(userId, { total_score: (profile.total_score || 0) + bonus });

    const player = players.find(p => p.user_id === userId);
    if (player) await updateGamePlayerScore(gameId, userId, (player.score || 0) + bonus);

    return bonus;
  }

  /* realtime channel subscription (no-op safe wrapper for demo mode) */
  function subscribeToGame(gameId, onChange){
    if (demoMode){
      const interval = setInterval(() => onChange({ polling: true }), 2000);
      return { unsubscribe: () => clearInterval(interval) };
    }
    const channel = client.channel("game-" + gameId)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_players", filter: `game_id=eq.${gameId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` }, onChange)
      .subscribe();
    return channel;
  }

  function unsubscribe(channel){
    if (!channel) return;
    if (channel.unsubscribe) channel.unsubscribe();
    else if (client) client.removeChannel(channel);
  }

  /* ================= SUB ADMIN ACCOUNTS (يُنشئها المشرف الرئيسي فقط) =================
     صلاحيات محدودة: إدارة الغرف الجماعية والأسئلة الخاصة بغرفهم فقط. نفس آلية حماية
     كلمة المرور المستخدمة لحساب المشرف الرئيسي أعلاه (بصمة + تحقق عبر RPC من جهة
     الخادم في وضع Supabase الحقيقي)، دون أي تسجيل ذاتي — الإنشاء حصري للمشرف الرئيسي. */
  async function createSubAdmin({ username, password }){
    username = (username || "").trim();
    if (!username || !password) throw new Error("الرجاء تعبئة جميع الحقول");
    if (username.length < 3) throw new Error("اسم المستخدم قصير جدًا (3 أحرف على الأقل)");
    if (password.length < 6) throw new Error("كلمة المرور يجب ألا تقل عن 6 أحرف");
    const passwordHash = simpleHash(password);

    if (demoMode){
      const all = lsGet(LS_KEYS.subAdmins, {});
      const key = username.toLowerCase();
      if (all[key]) throw new Error("اسم المستخدم مستخدم بالفعل، جرّب اسمًا آخر");
      const row = { id: newId("sub"), username, passwordHash, active: true, created_at: new Date().toISOString() };
      all[key] = row;
      lsSet(LS_KEYS.subAdmins, all);
      return row;
    }
    const { data, error } = await client.rpc("create_sub_admin", { p_username: username, p_password_hash: passwordHash });
    if (error) throw new Error(/مستخدم/.test(error.message) ? "اسم المستخدم مستخدم بالفعل، جرّب اسمًا آخر" : error.message);
    // create_sub_admin يُعيد المعرّف (uuid) فقط في مخططك الفعلي — نبني الصف كاملاً هنا
    return { id: data, username, active: true, created_at: new Date().toISOString() };
  }

  async function listSubAdmins(){
    if (demoMode) return Object.values(lsGet(LS_KEYS.subAdmins, {}));
    const { data, error } = await client.rpc("list_sub_admins");
    if (error){ console.error(error); return []; }
    // عمود التفعيل في مخططك الفعلي اسمه "enabled" — نطابقه هنا مع "active"
    // المستخدمة في بقية الواجهة حتى لا يتغيّر أي كود آخر في admin.js
    return (data || []).map(r => ({ id: r.id, username: r.username, active: r.enabled, created_at: r.created_at }));
  }

  async function updateSubAdmin(id, patch){
    if (demoMode){
      const all = lsGet(LS_KEYS.subAdmins, {});
      const entry = Object.values(all).find(s => s.id === id);
      if (!entry) throw new Error("الحساب غير موجود");
      const oldKey = entry.username.toLowerCase();
      if (patch.username){
        const newKey = patch.username.trim().toLowerCase();
        if (newKey !== oldKey && all[newKey]) throw new Error("اسم المستخدم مستخدم بالفعل");
        entry.username = patch.username.trim();
      }
      if (patch.password){
        if (patch.password.length < 6) throw new Error("كلمة المرور يجب ألا تقل عن 6 أحرف");
        entry.passwordHash = simpleHash(patch.password);
      }
      if (patch.active !== undefined) entry.active = patch.active;
      delete all[oldKey];
      all[entry.username.toLowerCase()] = entry;
      lsSet(LS_KEYS.subAdmins, all);
      return entry;
    }
    // مخططك الفعلي يفصل التحديث على ثلاث دوال RPC مستقلة (بدل دالة واحدة موحّدة)،
    // فنستدعي كل واحدة منها فقط عند الحاجة إليها
    if (patch.username){
      const { error } = await client.rpc("update_sub_admin_username", { p_id: id, p_new_username: patch.username.trim() });
      if (error) throw new Error(/مستخدم/.test(error.message) ? "اسم المستخدم مستخدم بالفعل" : error.message);
    }
    if (patch.password){
      if (patch.password.length < 6) throw new Error("كلمة المرور يجب ألا تقل عن 6 أحرف");
      const { error } = await client.rpc("update_sub_admin_password", { p_id: id, p_new_hash: simpleHash(patch.password) });
      if (error) throw error;
    }
    if (patch.active !== undefined){
      const { error } = await client.rpc("set_sub_admin_enabled", { p_id: id, p_enabled: patch.active });
      if (error) throw error;
    }
    return true;
  }

  function setSubAdminActive(id, active){ return updateSubAdmin(id, { active }); }

  async function deleteSubAdmin(id){
    if (demoMode){
      const all = lsGet(LS_KEYS.subAdmins, {});
      const key = Object.keys(all).find(k => all[k].id === id);
      if (key) delete all[key];
      lsSet(LS_KEYS.subAdmins, all);
      return true;
    }
    const { error } = await client.rpc("delete_sub_admin", { p_id: id });
    if (error) throw error;
    return true;
  }

  async function subAdminLogin(username, password){
    username = (username || "").trim();
    if (!username || !password) throw new Error("الرجاء تعبئة جميع الحقول");
    const passwordHash = simpleHash(password);

    if (demoMode){
      const all = lsGet(LS_KEYS.subAdmins, {});
      const acc = all[username.toLowerCase()];
      if (!acc || acc.passwordHash !== passwordHash) throw new Error("بيانات الدخول غير صحيحة");
      if (!acc.active) throw new Error("تم إيقاف هذا الحساب من قبل المشرف الرئيسي");
      return { id: acc.id, username: acc.username };
    }
    // verify_sub_admin_login يُعيد فقط { id, enabled } (بلا username) في مخططك
    // الفعلي — نستخدم اسم المستخدم الذي أدخله المستخدم نفسه لبناء الجلسة
    const { data, error } = await client.rpc("verify_sub_admin_login", { p_username: username, p_password_hash: passwordHash });
    if (error) throw new Error("بيانات الدخول غير صحيحة");
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("بيانات الدخول غير صحيحة");
    if (row.enabled === false) throw new Error("تم إيقاف هذا الحساب من قبل المشرف الرئيسي");
    return { id: row.id, username };
  }

  /* ================= ACTIVITY LOG (نشاط المشرفين الفرعيين) =================
     يسجّل كل عملية مؤثرة (دخول/خروج/إنشاء غرفة/تعديل/حذف/إضافة سؤال...) ليراها
     المشرف الرئيسي فقط. لا يملك أي مشرف فرعي صلاحية حذف أو تعديل هذا السجل. */
  async function logActivity({ actorUsername, actorRole, action, roomName, questionInfo }){
    const row = {
      id: newId("log"),
      actor_username: actorUsername || "—",
      actor_role: actorRole || "subadmin",
      action,
      room_name: roomName || null,
      question_info: questionInfo || null,
      created_at: new Date().toISOString(),
    };
    if (demoMode){
      const log = lsGet(LS_KEYS.activityLog, []);
      log.unshift(row);
      lsSet(LS_KEYS.activityLog, log.slice(0, 500));
      return row;
    }
    const { error } = await client.from("activity_log").insert(row);
    if (error) console.error(error);
    return row;
  }

  async function getActivityLog(limit = 300){
    if (demoMode) return lsGet(LS_KEYS.activityLog, []).slice(0, limit);
    const { data, error } = await client.from("activity_log").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error){ console.error(error); return []; }
    return data || [];
  }

  /* غرف مالكها مشرف فرعي محدد فقط — يُستخدم لتصفية لوحة "الغرف الجماعية" وقت
     دخول مشرف فرعي، بينما يستمر المشرف الرئيسي برؤية كل الغرف كما هي العادة */
  async function getGamesForOwner(ownerUsername){
    const games = await getGames();
    if (!ownerUsername) return games;
    return games.filter(g => g.owner_username === ownerUsername);
  }

  /* أسئلة أنشأها مشرف فرعي محدد فقط (سواء عامة له أو مرتبطة بغرفة من غرفه) */
  async function getQuestionsForOwner(ownerUsername){
    const all = await getQuestions({});
    if (!ownerUsername) return all;
    return all.filter(q => q.owner_username === ownerUsername);
  }

  /* ================= admin auth (حساب مشرف واحد ثابت، بلا بريد إلكتروني ولا Supabase Auth) ================= */
  /* ================= admin auth (حساب مشرف واحد محمي في قاعدة البيانات — بدون أي بيانات دخول
     مكتوبة في كود JavaScript). آلية التمهيد الذاتي: أول محاولة تسجيل دخول تُنشئ حساب المشرف
     الوحيد تلقائيًا بالاسم وكلمة المرور المُدخَلين، وتُغلق الباب أمام أي محاولة إنشاء حساب
     مشرف آخر بعد ذلك — راجع bootstrap_admin في sql/schema.sql. ================= */
  async function adminLogin(username, password){
    username = (username || "").trim();
    if (!username || !password) throw new Error("الرجاء تعبئة جميع الحقول");
    const passwordHash = simpleHash(password);

    if (demoMode){
      const accounts = lsGet(LS_KEYS.adminAccounts, {});
      if (Object.keys(accounts).length === 0){
        // لا يوجد مشرف مسجّل بعد في هذا المتصفح: هذه المحاولة الأولى تُنشئ الحساب تلقائيًا
        accounts[username.toLowerCase()] = { username, passwordHash };
        lsSet(LS_KEYS.adminAccounts, accounts);
        return { username, bootstrapped: true };
      }
      const acc = accounts[username.toLowerCase()];
      if (!acc || acc.passwordHash !== passwordHash){
        throw new Error("بيانات الدخول غير صحيحة، أو الحساب لا يملك صلاحية المشرف.");
      }
      return { username };
    }

    const { data: valid, error: verifyErr } = await client.rpc("verify_admin_login", {
      p_username: username, p_password_hash: passwordHash,
    });
    if (!verifyErr && valid) return { username };

    // لا يوجد تطابق — تحقق: هل هذه أول محاولة تسجيل دخول إطلاقًا (لا يوجد أي مشرف بعد)؟
    const { data: hasAdmin, error: hasErr } = await client.rpc("has_any_admin");
    if (!hasErr && hasAdmin === false){
      const { data: created, error: bootErr } = await client.rpc("bootstrap_admin", {
        p_username: username, p_password_hash: passwordHash,
      });
      if (!bootErr && created) return { username, bootstrapped: true };
    }

    throw new Error("بيانات الدخول غير صحيحة، أو الحساب لا يملك صلاحية المشرف.");
  }

  async function changeAdminPassword(username, oldPassword, newPassword){
    if (newPassword.length < 6) throw new Error("كلمة المرور يجب ألا تقل عن 6 أحرف");
    const oldHash = simpleHash(oldPassword);
    const newHash = simpleHash(newPassword);

    if (demoMode){
      const accounts = lsGet(LS_KEYS.adminAccounts, {});
      const key = username.toLowerCase();
      if (!accounts[key] || accounts[key].passwordHash !== oldHash) throw new Error("كلمة المرور الحالية غير صحيحة");
      accounts[key].passwordHash = newHash;
      lsSet(LS_KEYS.adminAccounts, accounts);
      return true;
    }
    const { data: ok, error } = await client.rpc("set_admin_password", {
      p_username: username, p_old_hash: oldHash, p_new_hash: newHash,
    });
    if (error || !ok) throw new Error("كلمة المرور الحالية غير صحيحة");
    return true;
  }

  /* ================= stats (admin dashboard) ================= */
  async function getStats(){
    const questions = demoMode ? ensureDemoQuestions() : (await client.from("questions").select("*")).data || [];
    const profiles = await listAllProfiles();
    const history = await getAllHistory();
    const games = demoMode ? lsGet(LS_KEYS.games, []) : (await client.from("games").select("*")).data || [];

    const catCounts = {};
    history.forEach(h => { if (h.category) catCounts[h.category] = (catCounts[h.category] || 0) + 1; });
    let topCategory = null, topCount = 0;
    Object.entries(catCounts).forEach(([c, n]) => { if (n > topCount){ topCategory = c; topCount = n; } });

    return {
      totalPlayers: profiles.length,
      totalQuizzes: history.length,
      totalQuestions: questions.length,
      totalGames: games.length,
      highestScore: profiles.reduce((m, p) => Math.max(m, p.total_score || 0), 0),
      topCategory: topCategory ? catName(topCategory) : "—",
    };
  }

  /* ---------------- utils ---------------- */
  function shuffle(arr){
    for (let i = arr.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function levelForScore(score){
    if (score >= 1000) return { name: "عبقري", emoji: "👑" };
    if (score >= 500) return { name: "خبير", emoji: "🥇" };
    if (score >= 100) return { name: "متعلم", emoji: "🥈" };
    return { name: "مبتدئ", emoji: "🥉" };
  }

  return {
    init, isConfigured,
    get isDemoMode(){ return demoMode; },
    get client(){ return client; },
    get session(){ return currentSession; },
    getCurrentUserId,

    signUp, signIn, signOut, restoreSession, changePassword,
    getProfile, updateProfile, listAllProfiles, getRank,
    addGameHistory, getGameHistory, getAllHistory,
    computeAchievements, syncAchievements,
    submitQuizResult,

    getQuestions, saveQuestion, deleteQuestion,
    getLeaderboard,
    getGames, saveGame, deleteGame, joinGame, getGamePlayers, updateGamePlayerScore, awardRoomPlacementBonus, subscribeToGame, unsubscribe,
    canPlay, grantReplay, getQuestionCounts, saveQuestionCounts,
    hasPlayedGame, canJoinRoom, grantRoomRejoin, grantRoomRejoinByUsername,
    getCategoryTimers, saveCategoryTimers,
    getQuestionTypeTimers, saveQuestionTypeTimers,
    getAgeTimerSettings, saveAgeTimerSetting, deleteAgeTimerSetting, resolveQuestionTimer,
    getQuizSettings, saveQuizSettings,
    adminLogin, changeAdminPassword, getStats,
    levelForScore, shuffle,

    createSubAdmin, listSubAdmins, updateSubAdmin, setSubAdminActive, deleteSubAdmin, subAdminLogin,
    logActivity, getActivityLog, getGamesForOwner, getQuestionsForOwner,
    getQuestionSuggestions, approveQuestionSuggestion, removeGamePlayer,
  };
})();
