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
    customCategories: "qv_demo_custom_categories", // [{ id, name, icon }] فئات أضافها المشرف فوق الاثنتي عشرة الأساسية
    maxTotalPlayers: "qv_demo_max_total_players", // رقم (0 = بلا حد أقصى)
    adminAccounts: "qv_demo_admin_accounts", // username(lowercase) -> { username, passwordHash } — نفس آلية bootstrap
    subAdmins: "qv_demo_sub_admins",  // username(lowercase) -> { id, username, passwordHash, active, created_at }
    activityLog: "qv_demo_activity_log", // مصفوفة بأحدث العمليات أولًا
    marathons: "qv_demo_marathons",       // مصفوفة كائنات الماراثون
    marathonPlayers: "qv_demo_marathon_players", // { marathonId: { userId: playerRow } }
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
      achievements: [], completed_combos: [], replay_grants: {}, room_rejoin_grants: {}, combo_last_played: {}, suggestions_locked: false,
      // إحصائيات وضع "🎲 التحدي العشوائي" — منفصلة تمامًا عن إحصائيات اللاعب العامة
      random_challenges_played: 0, random_challenges_won: 0, random_challenge_perfect_count: 0,
      random_challenge_best_score: 0, random_challenge_best_category: null, random_challenge_best_avg_time: null,
      // عدّاد يومي منفصل: يسمح بمحاولتين (2) للتحدي العشوائي كل يوم، ويُصفَّر
      // تلقائيًا تمامًا كآلية "محاولة جديدة كل يوم" للاختبارات العادية
      random_challenge_daily_count: 0, random_challenge_daily_date: null,
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

    // الحد الأقصى الكلي للاعبين المسجّلين (إن فعّله المشرف) — يُتحقّق منه قبل
    // إنشاء أي حساب جديد، فلا يمكن تجاوزه حتى لو استُدعيت هذه الدالة مباشرة
    const maxPlayers = await getMaxTotalPlayers();
    if (maxPlayers > 0){
      const current = await listAllProfiles();
      if (current.length >= maxPlayers){
        throw new Error(`التسجيل مغلق حاليًا — اكتمل العدد الأقصى المسموح به من اللاعبين (${maxPlayers})`);
      }
    }

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
      if (insertErr){
        // شبكة أمان: إن لم يُنفَّذ ملف sql/migrate_random_challenge.sql بعد،
        // لا نريد أن يفشل إنشاء الحساب بالكامل بسبب أعمدة إحصائيات "التحدي
        // العشوائي" الناقصة فقط — نعيد المحاولة بدونها تحديدًا مع تحذير واضح
        const randomChallengeFields = [
          "random_challenges_played", "random_challenges_won", "random_challenge_perfect_count",
          "random_challenge_best_score", "random_challenge_best_category", "random_challenge_best_avg_time",
          "random_challenge_daily_count", "random_challenge_daily_date",
        ];
        const isMissingRcColumn = randomChallengeFields.some(f => (insertErr.message || "").includes(f));
        if (isMissingRcColumn){
          console.warn("أعمدة إحصائيات التحدي العشوائي غير موجودة بعد في قاعدة البيانات — نفّذ sql/migrate_random_challenge.sql و sql/migrate_random_challenge_daily_limit.sql. تم إنشاء الحساب بدونها مؤقتًا.", insertErr);
          const fallbackProfile = { ...profile };
          randomChallengeFields.forEach(f => delete fallbackProfile[f]);
          const { error: retryErr } = await client.from("profiles").insert(fallbackProfile);
          if (retryErr) throw retryErr;
        } else {
          throw insertErr;
        }
      }
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

    // تتبّع فئة+مستوى مكتملة، وتسجيل "تاريخ آخر لعب" لكل تركيبة حتى تُفتح
    // تلقائيًا من جديد في اليوم التالي لكل لاعب (راجع canPlay أدناه لشرح
    // الأولوية الكاملة)، واستهلاك محاولة إضافية ممنوحة من المشرف فقط إن كانت
    // هذه محاولة ثانية أو أكثر لنفس التركيبة في نفس اليوم، وتسجيل أسئلة هذا
    // الاختبار كـ"حديثة" لمنع تكرارها في المرة القادمة
    if (result.difficulty){
      const comboKey = result.category + ":" + result.difficulty;
      const completed = (profile.completed_combos || []).slice();
      const grants = { ...(profile.replay_grants || {}) };
      const lastPlayed = { ...(profile.combo_last_played || {}) };

      if (lastPlayed[comboKey] === today){
        // لعبها اليوم بالفعل من قبل — هذه محاولة إضافية استُهلكت من رصيد
        // منحه المشرف يدويًا (لا علاقة لها بالفتح التلقائي اليومي)
        if (grants[comboKey] > 0) grants[comboKey] -= 1;
      }
      if (!completed.includes(comboKey)) completed.push(comboKey);
      lastPlayed[comboKey] = today;

      patch.completed_combos = completed;
      patch.replay_grants = grants;
      patch.combo_last_played = lastPlayed;

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

    let updated;
    try{
      updated = await updateProfile(userId, patch);
    }catch(err){
      // شبكة أمان: إن لم يُنفَّذ ملف SQL الذي يضيف عمود combo_last_played بعد
      // (راجع sql/migrate_daily_replay.sql)، لا نريد أن يفشل حفظ النتيجة
      // بالكامل (النقاط، الإحصائيات...) بسبب عمود واحد ناقص فقط — نعيد
      // المحاولة بدون هذا الحقل تحديدًا، مع تحذير واضح في الـ console
      if (/combo_last_played/i.test(err.message || "")){
        console.warn("عمود combo_last_played غير موجود بعد في قاعدة البيانات — نفّذ sql/migrate_daily_replay.sql حتى تعمل ميزة \"محاولة جديدة كل يوم\" بشكل صحيح.", err);
        const { combo_last_played, ...patchWithoutCombo } = patch;
        updated = await updateProfile(userId, patchWithoutCombo);
      } else {
        throw err;
      }
    }

    await addGameHistory({
      user_id: userId, game_id: gameId || null, category: result.category,
      score: result.score, correct_count: result.correctCount, total: result.total,
    });

    const rank = await getRank(userId);
    const { newlyUnlocked } = await syncAchievements(updated, rank);

    return { profile: updated, rank, newlyUnlocked };
  }

  /* ================= PLAY RESTRICTIONS (مرة واحدة يوميًا لكل فئة+مستوى) =================
     كل تركيبة "فئة + مستوى" تُفتح تلقائيًا من جديد لكل لاعب مع بداية كل يوم
     ميلادي جديد — لا حاجة لانتظار المشرف. إن حاول اللاعب إعادة لعب نفس
     التركيبة مرة أخرى في نفس اليوم، يُطلب منه محاولة إضافية يمنحها المشرف
     يدويًا (عبر grantReplay أدناه) تمامًا كما كان الحال سابقًا. */
  function canPlay(profile, category, difficulty){
    if (!profile || !category || !difficulty) return true;
    const key = category + ":" + difficulty;
    const lastPlayed = (profile.combo_last_played || {})[key];
    if (!lastPlayed) return true; // لم يلعب هذه التركيبة من قبل إطلاقًا
    const today = new Date().toISOString().slice(0, 10);
    if (lastPlayed !== today) return true; // يوم جديد = فتح تلقائي لمحاولة جديدة
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

  /* ================= PLAYER SUGGESTION LOCK (منع لاعب محدد من اقتراح أسئلة) =================
     يستخدمها المشرف/المشرف الفرعي من "👤 اللاعبون" لمنع لاعب بعينه من إرسال
     اقتراحات أسئلة جديدة (مثلاً بعد إساءة استخدام الميزة)، دون التأثير على أي
     صلاحية أخرى لحسابه (يبقى بإمكانه اللعب، عرض ملفه، تغيير كلمة مروره...). */
  function setPlayerSuggestionsLocked(userId, locked){
    return updateProfile(userId, { suggestions_locked: !!locked });
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
    const { error } = await client.from("app_settings").upsert({ key: "question_counts", value: counts }, { onConflict: "key" });
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
    const { error } = await client.from("app_settings").upsert({ key: "category_timers", value: clean }, { onConflict: "key" });
    if (error) throw error;
    return clean;
  }

  /* ================= CUSTOM CATEGORIES (فئات معرفية يضيفها المشرف) =================
     الفئات الاثنتا عشرة الأساسية معرّفة ثابتًا في js/quiz-data.js (QUIZ_CATEGORIES)
     ولا تتغيّر. هذه الدوال تسمح للمشرف بإضافة فئات إضافية فوقها فقط، تُخزَّن في
     app_settings (أو localStorage في الوضع التجريبي) وتُدمج تلقائيًا مع
     QUIZ_CATEGORIES عند بدء التطبيق (راجع js/app.js) — بلا أي حاجة لتعديل
     ملفات الكود. يبقى بإمكان المشرف حذف الفئات التي أضافها هو فقط. */
  async function getCustomCategories(){
    if (demoMode) return lsGet(LS_KEYS.customCategories, []);
    const { data, error } = await client.from("app_settings").select("value").eq("key", "custom_categories").maybeSingle();
    if (error || !data) return [];
    return data.value || [];
  }

  async function addCategory({ name, icon }){
    name = (name || "").trim();
    icon = (icon || "").trim() || "🗂️";
    if (!name) throw new Error("الرجاء كتابة اسم الفئة");
    const custom = await getCustomCategories();
    if (custom.some(c => c.name === name)) throw new Error("توجد فئة بهذا الاسم بالفعل");
    // معرّف فريد تلقائي — لا حاجة لأن يكتبه المشرف يدويًا
    const id = "custom_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const row = { id, name, icon };
    const updated = [...custom, row];
    if (demoMode){ lsSet(LS_KEYS.customCategories, updated); return row; }
    const { error } = await client.from("app_settings").upsert({ key: "custom_categories", value: updated }, { onConflict: "key" });
    if (error) throw error;
    return row;
  }

  async function deleteCategory(id){
    if (!id || !String(id).startsWith("custom_")) throw new Error("لا يمكن حذف الفئات الأساسية في النظام");
    const updated = (await getCustomCategories()).filter(c => c.id !== id);
    if (demoMode){ lsSet(LS_KEYS.customCategories, updated); return true; }
    const { error } = await client.from("app_settings").upsert({ key: "custom_categories", value: updated }, { onConflict: "key" });
    if (error) throw error;
    return true;
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
    const { error } = await client.from("app_settings").upsert({ key: "type_timers", value: clean }, { onConflict: "key" });
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
    const { error } = await client.from("app_settings").upsert({ key: "quiz_settings", value: merged }, { onConflict: "key" });
    if (error) throw error;
    return merged;
  }

  /* ================= الحد الأقصى الكلي للاعبين المسجّلين في المنصة =================
     0 أو فارغ = بلا حد أقصى (السلوك الافتراضي، كما كان دائمًا). عند تفعيله،
     تُرفض محاولات إنشاء حساب جديد بمجرد الوصول للعدد المحدد — راجع signUp
     أعلاه، حيث يُتحقّق منه من جهة العميل (نفس مستوى الحماية المطبّق على بقية
     قيود هذا المشروع، لعدم وجود جلسات مصادقة حقيقية من جهة الخادم). */
  async function getMaxTotalPlayers(){
    if (demoMode) return lsGet(LS_KEYS.maxTotalPlayers, 0);
    const { data, error } = await client.from("app_settings").select("value").eq("key", "max_total_players").maybeSingle();
    if (error){
      // نُسجّل الخطأ الحقيقي بدل إخفائه بصمت — قد يعني ذلك وجود أكثر من صف
      // بنفس المفتاح (من محاولات حفظ سابقة قبل إصلاح onConflict)، وفي هذه
      // الحالة "maybeSingle" يرفض التنفيذ لأنه يتوقّع صفًا واحدًا كحد أقصى
      console.error("getMaxTotalPlayers:", error);
      return 0;
    }
    if (!data) return 0;
    return Number(data.value) || 0;
  }

  async function saveMaxTotalPlayers(n){
    const clean = Math.max(0, Math.floor(Number(n)) || 0);
    if (demoMode){ lsSet(LS_KEYS.maxTotalPlayers, clean); return clean; }
    const { error } = await client.from("app_settings").upsert({ key: "max_total_players", value: clean }, { onConflict: "key" });
    if (error) throw error;
    return clean;
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
      // توزيع الأسئلة حسب عدد أسئلة صريح لكل مستوى صعوبة (سهل/متوسط/صعب) —
      // القيم هنا أعداد فعلية وليست نسبًا مئوية؛ يبني المشرف/المشرف الفرعي
      // اختباره بدقة، مثال: 10 أسئلة كليًا → 4 سهل + 4 متوسط + 2 صعب
      const diffs = ["easy", "medium", "hard"];
      const totalCount = diffs.reduce((s, d) => s + (Number(difficultyDistribution[d]) || 0), 0);
      if (totalCount > 0){
        const parts = [];
        for (const d of diffs){
          const count = Number(difficultyDistribution[d]) || 0;
          if (count <= 0) continue;
          const pool = shuffle((await fetchQuestionPool({ category, roomId, difficulty: d, ageMin, ageMax, allowedTypes })).slice());
          parts.push(...pool.slice(0, count));
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

  /* ================= 🎲 RANDOM CHALLENGE (تحدٍ عشوائي) =================
     يُستدعى إضافيًا بعد submitQuizResult العادية تمامًا (دون أي تعديل عليها)،
     لتحديث إحصائيات وضع التحدي العشوائي فقط: عدد المحاولات، عدد "الفوز" (نصف
     الأسئلة صحيحة فأكثر)، عدد الإتمامات المثالية، وأفضل نتيجة محقَّقة (مع
     الفئة والزمن المتوسط المرتبطين بها). */
  async function submitRandomChallengeResult(userId, result){
    const profile = await getProfile(userId);
    if (!profile) throw new Error("اللاعب غير موجود");

    const played = (profile.random_challenges_played || 0) + 1;
    const isWin = result.total > 0 && (result.correctCount / result.total) >= 0.5;
    const won = (profile.random_challenges_won || 0) + (isWin ? 1 : 0);
    const isPerfect = result.total > 0 && result.correctCount === result.total;
    const perfectCount = (profile.random_challenge_perfect_count || 0) + (isPerfect ? 1 : 0);

    // ملاحظة: عدّاد المحاولات اليومية لا يُلمس هنا إطلاقًا — يُستهلك فور
    // دخول اللاعب للتحدي (راجع consumeRandomChallengeAttempt)، وليس فقط
    // عند إكماله، حتى يُحتسب عليه دخوله ثم الخروج قبل اللعب الفعلي أيضًا
    const patch = {
      random_challenges_played: played,
      random_challenges_won: won,
      random_challenge_perfect_count: perfectCount,
    };
    if (result.score > (profile.random_challenge_best_score || 0)){
      patch.random_challenge_best_score = result.score;
      patch.random_challenge_best_category = result.category || null;
      patch.random_challenge_best_avg_time = result.avgTime != null ? result.avgTime : null;
    }
    return updateProfile(userId, patch);
  }

  /* ================= حد المحاولات اليومية للتحدي العشوائي (محاولتان كحد أقصى) =================
     يُفتح تلقائيًا من جديد مع أول محاولة في كل يوم ميلادي جديد — تمامًا كآلية
     "محاولة جديدة كل يوم" المطبّقة على الاختبارات العادية (canPlay أعلاه).
     الاستهلاك يحصل فور دخول اللاعب للتحدي (شاشة المعاينة)، وليس فقط عند
     إكماله — فحتى الخروج قبل الضغط على "ابدأ التحدي" يُحتسب محاولة. */
  function canPlayRandomChallenge(profile){
    if (!profile) return true;
    const today = new Date().toISOString().slice(0, 10);
    if (profile.random_challenge_daily_date !== today) return true;
    return (profile.random_challenge_daily_count || 0) < 2;
  }

  function randomChallengeRemainingToday(profile){
    if (!profile) return 2;
    const today = new Date().toISOString().slice(0, 10);
    const used = profile.random_challenge_daily_date === today ? (profile.random_challenge_daily_count || 0) : 0;
    return Math.max(0, 2 - used);
  }

  async function consumeRandomChallengeAttempt(userId){
    const profile = await getProfile(userId);
    if (!profile) throw new Error("اللاعب غير موجود");
    const today = new Date().toISOString().slice(0, 10);
    const dailyCount = profile.random_challenge_daily_date === today ? (profile.random_challenge_daily_count || 0) + 1 : 1;
    return updateProfile(userId, {
      random_challenge_daily_count: dailyCount,
      random_challenge_daily_date: today,
    });
  }

  /* لوحة متصدرين منفصلة خاصة بوضع التحدي العشوائي فقط — مرتّبة حسب أفضل
     نتيجة حقّقها كل لاعب في هذا الوضع تحديدًا (منفصلة تمامًا عن لوحة
     المتصدرين العامة المرتّبة حسب إجمالي النقاط) */
  async function getRandomChallengeLeaderboard(){
    const profiles = await listAllProfiles();
    return profiles
      .filter(p => (p.random_challenges_played || 0) > 0)
      .slice()
      .sort((a, b) => (b.random_challenge_best_score || 0) - (a.random_challenge_best_score || 0))
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

  /* =========================================================
     🏁 MARATHON MODE (حدث بقاء تنافسي مباشر)
     =========================================================
     يشارك بنية مشابهة لـ games/game_players (مجموعة أسئلة ثابتة يُولّدها
     المشرف عند "بدء الآن"، وتحديثات لحظية عبر marathon_players)، مع فارق
     جوهري: التوقيت. بما أن هذا المشروع بلا أي خادم أو دالة سحابية مركزية
     تُقدّم الأسئلة تباعًا، يُحسب "السؤال الحالي" بشكل حتمي بحتًا من الزمن
     الفعلي المنقضي منذ actual_start_at ومدة كل سؤال — فيتفق كل المتصلين
     (لاعبين ومتفرجين) تلقائيًا على نفس السؤال في نفس اللحظة دون أي تنسيق
     مركزي إضافي. راجع marathon.js لتفاصيل هذا الحساب في الواجهة. */

  async function getMarathons(){
    if (demoMode) return lsGet(LS_KEYS.marathons, []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const { data, error } = await client.from("marathons").select("*").order("created_at", { ascending: false });
    if (error){ console.error(error); return []; }
    return data;
  }

  async function saveMarathon(m){
    if (demoMode){
      let all = lsGet(LS_KEYS.marathons, []);
      if (m.id){
        all = all.map(item => item.id === m.id ? { ...item, ...m } : item);
      } else {
        m.id = "mar-" + Date.now();
        m.status = m.status || "draft";
        m.created_at = new Date().toISOString();
        all.push(m);
      }
      lsSet(LS_KEYS.marathons, all);
      return m;
    }
    if (m.id){
      const { data, error } = await client.from("marathons").update(m).eq("id", m.id).select().single();
      if (error) throw error;
      return data;
    }
    delete m.id;
    const { data, error } = await client.from("marathons").insert(m).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteMarathon(id){
    if (demoMode){
      lsSet(LS_KEYS.marathons, lsGet(LS_KEYS.marathons, []).filter(m => m.id !== id));
      const all = lsGet(LS_KEYS.marathonPlayers, {});
      delete all[id];
      lsSet(LS_KEYS.marathonPlayers, all);
      return true;
    }
    const { error } = await client.from("marathons").delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  /* الماراثون الأنسب لعرضه كإعلان على لوحة اللاعب: "started" له الأولوية
     دائمًا (حدث جارٍ الآن)، وإلا أقرب "published" زمنيًا من حيث الموعد */
  async function getActiveMarathon(){
    const all = await getMarathons();
    const active = all.filter(m => m.status === "published" || m.status === "started");
    if (!active.length) return null;
    active.sort((a, b) => {
      if (a.status !== b.status) return a.status === "started" ? -1 : 1;
      return new Date(a.start_date + "T" + a.start_time) - new Date(b.start_date + "T" + b.start_time);
    });
    return active[0];
  }

  /* يُولّد مجموعة الأسئلة الثابتة (نفسها ونفس ترتيبها لكل اللاعبين لعدالة
     المنافسة، تمامًا كآلية بدء الغرف الجماعية) ويضبط اللحظة الفعلية للبدء */
  /* يُولّد مجموعة الأسئلة الثابتة (نفس الأسئلة لكل اللاعبين لعدالة المنافسة،
     لكن كل لاعب يرى ترتيبها بترتيب مُبعثر خاص به — راجع marathon.js) ويضبط
     اللحظة الفعلية للبدء. اعتبارًا من هذا التحديث:
       • الفئة المعرفية دائمًا "مزيج" من كل الفئات المتاحة، وليست فئة واحدة
       • مستوى الصعوبة يتصاعد تلقائيًا من سهل إلى متوسط إلى صعب على طول
         مسبح الأسئلة (لا يختاره المشرف يدويًا بعد الآن)
       • كل سؤال يظهر مرة واحدة فقط بالضبط ضمن هذا المسبح (بلا أي تكرار) */
  async function startMarathonNow(id){
    const all = await getMarathons();
    const m = all.find(x => x.id === id);
    if (!m) throw new Error("الماراثون غير موجود");

    // يدعم الماراثون الآن كل أنواع الأسئلة الأربعة (اختيار من متعدد، صح/خطأ،
    // مطابقة، ترتيب) — كل نوع له مؤقته الخاص إن فعّل المشرف "⏱️ وقت مخصص"
    const pool = await getQuestions({ ageMin: m.age_min, ageMax: m.age_max });
    const allowedMarathonTypes = ["multiple_choice", "true_false", "matching", "ordering"];
    const filtered = pool.filter(q => allowedMarathonTypes.includes(q.type || "multiple_choice"));
    if (!filtered.length) throw new Error("لا توجد أسئلة كافية مطابقة للفئة العمرية المحددة");

    const byDiff = { easy: [], medium: [], hard: [] };
    filtered.forEach(q => { (byDiff[q.difficulty] || byDiff.medium).push(q); });
    byDiff.easy = shuffle(byDiff.easy.slice());
    byDiff.medium = shuffle(byDiff.medium.slice());
    byDiff.hard = shuffle(byDiff.hard.slice());

    // نُقسّم عدد الأسئلة المطلوب إلى ثلاث حصص متساوية تقريبًا: سهل ثم متوسط
    // ثم صعب — بحيث يبدأ الماراثون سهلاً ويتصاعد تدريجيًا نحو الأصعب كلما
    // تقدّم اللاعبون الناجون، مع سدّ أي نقص في مستوى معيّن من بقية المستويات
    // حتى نصل للعدد المطلوب قدر الإمكان (بلا أي تكرار لنفس السؤال إطلاقًا)
    const perBand = Math.ceil(m.question_count / 3);
    let ordered = [...byDiff.easy.slice(0, perBand), ...byDiff.medium.slice(0, perBand), ...byDiff.hard.slice(0, perBand)];
    if (ordered.length < m.question_count){
      const usedIds = new Set(ordered.map(q => q.id));
      const remainder = [...byDiff.easy, ...byDiff.medium, ...byDiff.hard].filter(q => !usedIds.has(q.id));
      ordered = ordered.concat(remainder.slice(0, m.question_count - ordered.length));
    }
    ordered = ordered.slice(0, m.question_count);

    if (!ordered.length) throw new Error("لا توجد أسئلة كافية مطابقة للفئة العمرية المحددة");
    return saveMarathon({
      id, status: "started", actual_start_at: new Date().toISOString(), question_set: ordered,
      category: "mixed", difficulty: "mixed",
    });
  }

  async function getMarathonPlayers(marathonId){
    if (demoMode){
      const all = lsGet(LS_KEYS.marathonPlayers, {});
      return Object.values(all[marathonId] || {});
    }
    const { data, error } = await client.from("marathon_players").select("*").eq("marathon_id", marathonId);
    if (error){ console.error(error); return []; }
    return data;
  }

  async function getMarathonPlayer(marathonId, userId){
    if (demoMode){
      const all = lsGet(LS_KEYS.marathonPlayers, {});
      return (all[marathonId] && all[marathonId][userId]) || null;
    }
    const { data, error } = await client.from("marathon_players").select("*").eq("marathon_id", marathonId).eq("user_id", userId).maybeSingle();
    if (error){ console.error(error); return null; }
    return data;
  }

  async function updateMarathonPlayer(id, patch){
    if (demoMode){
      const all = lsGet(LS_KEYS.marathonPlayers, {});
      for (const mid in all){
        for (const uid in all[mid]){
          if (all[mid][uid].id === id){
            all[mid][uid] = { ...all[mid][uid], ...patch };
            lsSet(LS_KEYS.marathonPlayers, all);
            return all[mid][uid];
          }
        }
      }
      return null;
    }
    const { data, error } = await client.from("marathon_players").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  /* الانضمام لماراثون: إمّا مشاركة جديدة تمامًا، أو إعادة انضمام بعد أن سمح
     المشرف صراحة بذلك (replay_allowed) — راجع القيد الفريد على
     (marathon_id, user_id) في sql/migrate_marathon_mode.sql، فأي استدعاء
     لاحق لنفس اللاعب في نفس الماراثون يُحدَّث بدل أن يُنشئ صفًا مكررًا */
  async function joinMarathon(marathonId, player){
    const existing = await getMarathonPlayer(marathonId, player.userId);
    const row = {
      marathon_id: marathonId, user_id: player.userId, username: player.name, avatar: player.avatar,
      status: "alive", questions_answered: 0, correct_answers: 0, current_streak: 0,
      highest_streak: existing ? (existing.highest_streak || 0) : 0,
      survived_seconds: 0, marathon_score: 0, rank: null,
      attempts: existing ? (existing.attempts || 1) + 1 : 1,
      replay_allowed: false, eliminated_at: null, joined_at: new Date().toISOString(),
    };
    if (demoMode){
      const all = lsGet(LS_KEYS.marathonPlayers, {});
      all[marathonId] = all[marathonId] || {};
      row.id = existing ? existing.id : newId("mp");
      all[marathonId][player.userId] = row;
      lsSet(LS_KEYS.marathonPlayers, all);
      return row;
    }
    const { data, error } = await client.from("marathon_players").upsert(row, { onConflict: "marathon_id,user_id" }).select().single();
    if (error) throw error;
    return data;
  }

  /* يمنح المشرف إذنًا صريحًا للاعب سبق أن شارك بإعادة الانضمام — يبقى سجلّه
     السابق (أعلى streak محقَّق مثلاً) حتى ينضم فعليًا فتُصفَّر إحصائيات
     المحاولة الجديدة (راجع joinMarathon أعلاه) */
  async function allowMarathonReplay(marathonId, userId){
    const p = await getMarathonPlayer(marathonId, userId);
    if (!p) throw new Error("اللاعب لم يشارك في هذا الماراثون بعد");
    return updateMarathonPlayer(p.id, { replay_allowed: true });
  }

  /* يصفّر محاولة اللاعب بالكامل فورًا (بخلاف "السماح بإعادة اللعب" الذي
     ينتظر انضمامه من جديد) — يُستخدم لتصحيح خطأ إداري مثلاً */
  async function resetMarathonAttempt(marathonId, userId){
    const p = await getMarathonPlayer(marathonId, userId);
    if (!p) throw new Error("اللاعب لم يشارك في هذا الماراثون بعد");
    return updateMarathonPlayer(p.id, {
      status: "alive", questions_answered: 0, correct_answers: 0, current_streak: 0,
      highest_streak: 0, survived_seconds: 0, marathon_score: 0, rank: null,
      attempts: 0, replay_allowed: true, eliminated_at: null,
    });
  }

  /* يُسجَّل عند كل إجابة أثناء الماراثون: إجابة صحيحة تُطيل سلسلة الصمود
     وتضيف 5 نقاط لمجموع الماراثون (يُضاف لاحقًا لإجمالي نقاط اللاعب دفعة
     واحدة عند إنهاء المشرف للماراثون — راجع finalizeMarathon)، وإجابة
     خاطئة أو انتهاء الوقت تُقصي اللاعب فورًا من البقاء حيًا */
  async function recordMarathonAnswer(marathonId, userId, { correct, survivedSeconds }){
    const p = await getMarathonPlayer(marathonId, userId);
    if (!p || p.status !== "alive") return p;
    const questionsAnswered = (p.questions_answered || 0) + 1;
    let patch;
    if (correct){
      const streak = (p.current_streak || 0) + 1;
      patch = {
        questions_answered: questionsAnswered,
        correct_answers: (p.correct_answers || 0) + 1,
        current_streak: streak,
        highest_streak: Math.max(p.highest_streak || 0, streak),
        marathon_score: (p.marathon_score || 0) + 5,
      };
    } else {
      patch = {
        questions_answered: questionsAnswered,
        current_streak: 0,
        status: "eliminated",
        eliminated_at: new Date().toISOString(),
        survived_seconds: survivedSeconds != null ? Math.round(survivedSeconds) : (p.survived_seconds || 0),
      };
    }
    return updateMarathonPlayer(p.id, patch);
  }

  /* لاعب صمد حتى نهاية "مسبح" الأسئلة كله دون أن يُقصى (نادر لكن ممكن) */
  async function finishMarathonSurvivor(marathonId, userId, survivedSeconds){
    const p = await getMarathonPlayer(marathonId, userId);
    if (!p) return null;
    return updateMarathonPlayer(p.id, {
      status: "finished",
      survived_seconds: survivedSeconds != null ? Math.round(survivedSeconds) : (p.survived_seconds || 0),
    });
  }

  /* ================= إنهاء الماراثون: حساب الترتيب النهائي ومنح الجوائز =================
     يُستدعى من لوحة تحكم المشرف فقط ("🏁 إنهاء الآن"). يحسب ترتيبًا نهائيًا
     لكل المشاركين (الناجون/المُتمّون أولاً، ثم حسب أعلى سلسلة صمود، فعدد
     الأسئلة، فأطول مدة صمود)، يمنح مكافأة المراكز الثلاثة الأولى
     (+200/+150/+100)، ثم يضيف مجموع نقاط الماراثون الكامل لكل لاعب (نقاط
     الإجابات + مكافأة الترتيب إن وُجدت) إلى total_score دفعة واحدة، ويحدّث
     إحصائيات الماراثون التراكمية على ملفه الشخصي. */
  async function finalizeMarathon(marathonId){
    const players = await getMarathonPlayers(marathonId);
    if (!players.length){
      await saveMarathon({ id: marathonId, status: "finished" });
      return [];
    }

    const ranked = players.slice().sort((a, b) => {
      const aSurvived = a.status === "alive" || a.status === "finished";
      const bSurvived = b.status === "alive" || b.status === "finished";
      if (aSurvived !== bSurvived) return aSurvived ? -1 : 1;
      if ((b.highest_streak || 0) !== (a.highest_streak || 0)) return (b.highest_streak || 0) - (a.highest_streak || 0);
      if ((b.questions_answered || 0) !== (a.questions_answered || 0)) return (b.questions_answered || 0) - (a.questions_answered || 0);
      return (b.survived_seconds || 0) - (a.survived_seconds || 0);
    });

    const placementBonus = { 1: 200, 2: 150, 3: 100 };
    for (let i = 0; i < ranked.length; i++){
      const rank = i + 1;
      const p = ranked[i];
      const bonus = placementBonus[rank] || 0;
      const finalScore = (p.marathon_score || 0) + bonus;

      await updateMarathonPlayer(p.id, {
        rank, marathon_score: finalScore,
        status: p.status === "alive" ? "finished" : p.status,
      });

      try{
        const profile = await getProfile(p.user_id);
        if (profile){
          await updateProfile(p.user_id, {
            total_score: (profile.total_score || 0) + finalScore,
            marathons_joined: (profile.marathons_joined || 0) + 1,
            marathon_wins: (profile.marathon_wins || 0) + (rank === 1 ? 1 : 0),
            marathon_best_rank: (profile.marathon_best_rank == null || rank < profile.marathon_best_rank) ? rank : profile.marathon_best_rank,
            marathon_highest_streak: Math.max(profile.marathon_highest_streak || 0, p.highest_streak || 0),
            marathon_best_score: Math.max(profile.marathon_best_score || 0, finalScore),
          });
        }
      }catch(e){ console.error("تعذّر تحديث ملف اللاعب بعد الماراثون:", p.user_id, e); }
    }

    await saveMarathon({ id: marathonId, status: "finished" });
    return ranked;
  }

  /* لوحة ترتيب: بلا معرّف = عالمية (أفضل نتيجة ماراثون حقّقها كل لاعب عبر كل
     الماراثونات)، أو معرّف ماراثون محدد = ترتيب ذلك الحدث تحديدًا */
  async function getMarathonLeaderboard(marathonId){
    if (!marathonId || marathonId === "all"){
      const profiles = await listAllProfiles();
      return profiles
        .filter(p => (p.marathons_joined || 0) > 0)
        .slice()
        .sort((a, b) => (b.marathon_best_score || 0) - (a.marathon_best_score || 0))
        .map((p, i) => ({ ...p, rank: i + 1 }));
    }
    const players = await getMarathonPlayers(marathonId);
    return players.slice().sort((a, b) => (a.rank || 999) - (b.rank || 999) || (b.marathon_score || 0) - (a.marathon_score || 0));
  }

  function subscribeToMarathon(marathonId, onChange){
    if (demoMode){
      const interval = setInterval(() => onChange({ polling: true }), 2000);
      return { unsubscribe: () => clearInterval(interval) };
    }
    const channel = client.channel("marathon-" + marathonId)
      .on("postgres_changes", { event: "*", schema: "public", table: "marathon_players", filter: `marathon_id=eq.${marathonId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "marathons", filter: `id=eq.${marathonId}` }, onChange)
      .subscribe();
    return channel;
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
    // لا نُخفي الخطأ هنا بعد الآن — إخفاؤه كان يجعل القائمة تبدو فارغة بصمت
    // حتى لو كانت المشكلة صلاحيات أو دالة RPC غير محدَّثة، بينما الحسابات
    // موجودة فعليًا في قاعدة البيانات (نرميه ليظهر للمشرف عبر رسالة واضحة)
    if (error){ console.error("listSubAdmins:", error); throw new Error(error.message || "تعذّر جلب قائمة المشرفين الفرعيين من قاعدة البيانات"); }
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
    canPlay, grantReplay, setPlayerSuggestionsLocked, getQuestionCounts, saveQuestionCounts,
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
    getCustomCategories, addCategory, deleteCategory,
    getMaxTotalPlayers, saveMaxTotalPlayers,
    submitRandomChallengeResult, getRandomChallengeLeaderboard,
    canPlayRandomChallenge, randomChallengeRemainingToday, consumeRandomChallengeAttempt,

    getMarathons, saveMarathon, deleteMarathon, getActiveMarathon, startMarathonNow,
    getMarathonPlayers, getMarathonPlayer, joinMarathon, allowMarathonReplay, resetMarathonAttempt,
    recordMarathonAnswer, finishMarathonSurvivor, finalizeMarathon, getMarathonLeaderboard, subscribeToMarathon,
  };
})();
