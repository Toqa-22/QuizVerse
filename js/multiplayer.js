/* =========================================================
   الوضع الجماعي: قائمة الغرف، غرفة الانتظار، والبدء اللحظي
   عبر Supabase Realtime (مع نسخة محاكاة محلية للوضع التجريبي)
   ========================================================= */

const Multiplayer = (function(){
  let currentGame = null;
  let currentPlayerAge = null;
  let channel = null;
  let pollHandle = null;

  let listPlayerRef = null;
  let openRoomsCache = [];

  async function renderList(player){
    listPlayerRef = player;
    const wrap = document.getElementById("mp-list");
    wrap.innerHTML = `<p class="muted">جارٍ تحميل الغرف المتاحة...</p>`;
    const games = await QV.getGames();
    const open = games.filter(g => g.status !== "finished");

    // نحسب عدد اللاعبين المنضمين حاليًا لكل غرفة لعرضه في بطاقة الغرفة
    openRoomsCache = await Promise.all(open.map(async (g) => {
      const players = await QV.getGamePlayers(g.id);
      return { ...g, playerCount: players.length };
    }));

    const searchInput = document.getElementById("mp-search");
    if (searchInput && !searchInput.dataset.bound){
      searchInput.dataset.bound = "1";
      searchInput.addEventListener("input", () => renderFilteredList(searchInput.value));
    }
    if (searchInput) searchInput.value = "";

    renderFilteredList("");
  }

  function renderFilteredList(query){
    const wrap = document.getElementById("mp-list");
    const q = (query || "").trim().toLowerCase();
    const filtered = !q ? openRoomsCache : openRoomsCache.filter(g =>
      (g.title || "").toLowerCase().includes(q) ||
      catName(g.category).toLowerCase().includes(q) ||
      (g.category || "").toLowerCase().includes(q)
    );

    if (!openRoomsCache.length){
      wrap.innerHTML = `<div class="mp-empty">لا توجد غرف جماعية متاحة حاليًا.<br>يمكن لأحد المشرفين إنشاء غرفة جديدة من لوحة التحكم.</div>`;
      return;
    }
    if (!filtered.length){
      wrap.innerHTML = `<div class="mp-search-empty">لا توجد غرف مطابقة لبحثك.</div>`;
      return;
    }

    wrap.innerHTML = "";
    filtered.forEach(g => {
      const el = document.createElement("div");
      el.className = "mp-item";
      const isFull = g.max_players && g.playerCount >= g.max_players;
      const statusLabel = isFull ? "مكتملة" : { waiting: "بانتظار البدء", started: "جارية الآن", finished: "منتهية" }[g.status] || g.status;
      el.innerHTML = `
        <div>
          <h4>${escapeHtml(g.title)}</h4>
          <span class="mp-tag">${catIcon(g.category)} ${catName(g.category)} · ${g.question_count} أسئلة · ${g.timer_mode === "age_based" ? "⏱️ مؤقت حسب العمر" : g.time_per_question + "ث لكل سؤال"}</span>
          <br><span class="mp-tag">👥 ${g.playerCount || 0} / ${g.max_players} لاعب${escapeHtml(g.description ? " · " + g.description : "")}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="mp-status ${g.status}">${g.status === "started" ? "🔴 مباشر الآن" : statusLabel}</span>
          <button class="btn btn-primary" data-join="${g.id}" ${g.status === "finished" || isFull ? "disabled" : ""}>${g.status === "started" ? "انضم الآن" : "انضمام"}</button>
        </div>
      `;
      wrap.appendChild(el);
    });

    wrap.querySelectorAll("[data-join]").forEach(btn => {
      btn.addEventListener("click", () => join(btn.dataset.join, listPlayerRef));
    });
  }

  async function join(gameId, player){
    const games = await QV.getGames();
    currentGame = games.find(g => g.id === gameId);
    if (!currentGame) return;

    // يُسمح للاعب بإكمال أي غرفة مرة واحدة فقط، إلا إذا منحه المشرف إذن
    // إعادة انضمام صريحًا لهذه الغرفة تحديدًا
    const profile = await QV.getProfile(player.userId);
    const allowed = await QV.canJoinRoom(profile, gameId);
    if (!allowed){
      showToast("لقد شاركت في هذه الغرفة من قبل — تواصل مع المشرف للسماح لك بالانضمام مجددًا.");
      return;
    }

    currentPlayerAge = ageGroupToRange(player.age).min;
    await QV.joinGame(gameId, { name: player.name, age: player.age, avatar: player.avatar, user_id: player.userId, score: 0 });

    // "لعب مباشر": إن كانت الغرفة قد بدأت بالفعل، يدخل اللاعب الاختبار فورًا
    // بدل الانتظار — بإمكان اللاعبين الانضمام في أي وقت طالما الغرفة لا تزال
    // جارية (لم ينهِها المشرف بعد)
    if (currentGame.status === "started"){
      goTo("screen-mp-room");
      await renderRoom();
      launchGameQuiz();
      return;
    }

    goTo("screen-mp-room");
    renderRoom();
    watch();
  }

  async function renderRoom(){
    document.getElementById("mp-room-title").textContent = currentGame.title;
    document.getElementById("mp-room-desc").textContent = currentGame.description || "";
    document.getElementById("mp-room-max").textContent = currentGame.max_players;

    const players = await QV.getGamePlayers(currentGame.id);
    document.getElementById("mp-room-count").textContent = players.length;
    const list = document.getElementById("mp-players");
    list.innerHTML = players.map(p => `<li>${p.avatar ? p.avatar + " " : ""}${escapeHtml(p.name)}</li>`).join("") || `<li class="muted">لا يوجد لاعبون بعد</li>`;

    renderTopPlayers(players);
  }

  /* أفضل 3 لاعبين في هذه الغرفة تحديدًا، حسب نقاطهم داخل الغرفة نفسها */
  function renderTopPlayers(players){
    const box = document.getElementById("mp-top3");
    const listEl = document.getElementById("mp-top3-list");
    const top3 = players.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);

    if (!top3.length || top3.every(p => !(p.score > 0))){
      box.hidden = true;
      return;
    }

    box.hidden = false;
    const medals = ["🥇", "🥈", "🥉"];
    listEl.innerHTML = top3.map((p, i) => `
      <div class="mp-top3-row rank-${i + 1}">
        <span class="mp-top3-medal">${medals[i]}</span>
        <span class="mp-top3-avatar">${p.avatar || (p.name || "?").charAt(0).toUpperCase()}</span>
        <span class="mp-top3-name">${escapeHtml(p.name || "لاعب")}</span>
        <span class="mp-top3-score">${p.score || 0}</span>
      </div>
    `).join("");
  }

  /* ---------------- شاشة "ترتيب الغرف": ترتيب كل اللاعبين داخل كل غرفة،
     يبقى محفوظًا حتى يحذف المشرف الغرفة يدويًا (لا يُصفَّر تلقائيًا). ---------------- */
  async function renderRoomRankingsScreen(){
    const wrap = document.getElementById("room-rankings-list");
    wrap.innerHTML = `<p class="muted">جارٍ التحميل...</p>`;

    const games = await QV.getGames();
    if (!games.length){
      wrap.innerHTML = `<div class="mp-empty">لا توجد غرف جماعية بعد.</div>`;
      return;
    }

    const cards = await Promise.all(games.map(async (g) => {
      const players = await QV.getGamePlayers(g.id);
      const ranked = players.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
      const statusLabel = { waiting: "بانتظار البدء", started: "جارية الآن", finished: "منتهية" }[g.status] || g.status;

      const rows = ranked.length ? ranked.map((p, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
        return `
          <div class="lb-row${i < 3 ? " top-3 rank-" + (i + 1) : ""}">
            <span class="lb-rank">${typeof medal === "string" ? `<span class="lb-medal">${medal}</span>` : medal}</span>
            <span class="lb-avatar">${p.avatar || (p.name || "?").charAt(0).toUpperCase()}</span>
            <span class="lb-info"><strong>${escapeHtml(p.name || "لاعب")}</strong></span>
            <span class="lb-score">${p.score || 0}<span class="lb-score-label">نقطة</span></span>
          </div>`;
      }).join("") : `<p class="muted" style="padding:10px 0">لا يوجد لاعبون في هذه الغرفة بعد</p>`;

      return `
        <div class="glass-card room-rank-card">
          <div class="room-rank-head">
            <div>
              <h3>${escapeHtml(g.title)}</h3>
              <span class="mp-tag">${catIcon(g.category)} ${catName(g.category)} · ${ranked.length} لاعب</span>
            </div>
            <span class="mp-status ${g.status}">${statusLabel}</span>
          </div>
          <div class="lb-list room-rank-list">${rows}</div>
        </div>`;
    }));

    wrap.innerHTML = cards.join("");
  }

  function watch(){
    stopWatch();
    channel = QV.subscribeToGame(currentGame.id, async () => {
      const games = await QV.getGames();
      const fresh = games.find(g => g.id === currentGame.id);
      if (!fresh) return;
      currentGame = fresh;
      await renderRoom();
      if (fresh.status === "started"){
        stopWatch();
        launchGameQuiz();
      }
    });
  }

  function stopWatch(){
    if (channel){ QV.unsubscribe(channel); channel = null; }
    clearInterval(pollHandle);
  }

  async function launchGameQuiz(){
    document.getElementById("mp-waiting-text").textContent = "بدأ المضيف اللعبة! جارٍ التحميل...";
    QVSound.start();
    // نستخدم مجموعة الأسئلة الثابتة التي ولّدها المشرف عند بدء اللعبة (نفس الأسئلة
    // ونفس الترتيب لكل اللاعبين)، مع رجوع احتياطي لجلب مباشر إن لم تكن متوفرة
    const questions = (currentGame.question_set && currentGame.question_set.length)
      ? currentGame.question_set
      : await QV.getQuestions({
          category: currentGame.category,
          ageMin: currentGame.min_age, ageMax: currentGame.max_age,
          limit: currentGame.question_count,
        });

    // وضع "مخصص": نفس الوقت لكل اللاعبين كما هو محدد في الغرفة.
    // وضع "حسب العمر": كل لاعب يحسب مؤقته الخاص وفق عمره في متصفحه —
    // الأسئلة تبقى نفسها للجميع، فقط مدة العرض تختلف بين لاعب وآخر.
    const timePerQuestion = currentGame.timer_mode === "age_based"
      ? await QV.resolveQuestionTimer({ age: currentPlayerAge, category: currentGame.category })
      : currentGame.time_per_question;

    goTo("screen-quiz");
    await playQuizCountdown();
    QVSound.startMusic();
    QuizEngine.start({
      category: currentGame.category,
      timePerQuestion,
      // العمر يُمرَّر فقط في وضع "حسب العمر" — تبقى غرفة "مخصص" بمؤقتها الثابت
      // كما اختاره المشرف تمامًا لكل اللاعبين دون أي أولوية للعمر فيها
      age: currentGame.timer_mode === "age_based" ? currentPlayerAge : null,
      questions,
      // إعدادات عشوائية الإجابات الخاصة بهذه الغرفة تحديدًا (إن وُجدت) — راجع
      // ميزة "إعدادات العشوائية لكل غرفة" في لوحة تحكم المشرف/المشرف الفرعي
      settingsOverride: currentGame.quiz_random_settings || null,
      onFinish: (result) => window.onQuizFinished(result, true, currentGame.id),
    });
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  return { renderList, join, renderRoomRankingsScreen, get currentGame(){ return currentGame; } };
})();
