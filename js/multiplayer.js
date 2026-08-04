/* =========================================================
   الوضع الجماعي: قائمة الغرف، غرفة الانتظار، والبدء اللحظي
   عبر Supabase Realtime (مع نسخة محاكاة محلية للوضع التجريبي)
   ========================================================= */

const Multiplayer = (function(){
  let currentGame = null;
  let currentPlayerAge = null;
  let channel = null;
  let pollHandle = null;

  async function renderList(player){
    const wrap = document.getElementById("mp-list");
    wrap.innerHTML = `<p class="muted">جارٍ تحميل الغرف المتاحة...</p>`;
    const games = await QV.getGames();
    const open = games.filter(g => g.status !== "finished");

    if (!open.length){
      wrap.innerHTML = `<div class="mp-empty">لا توجد غرف جماعية متاحة حاليًا.<br>يمكن لأحد المشرفين إنشاء غرفة جديدة من لوحة التحكم.</div>`;
      return;
    }

    wrap.innerHTML = "";
    open.forEach(g => {
      const el = document.createElement("div");
      el.className = "mp-item";
      const statusLabel = { waiting: "بانتظار البدء", started: "جارية الآن", finished: "منتهية" }[g.status] || g.status;
      el.innerHTML = `
        <div>
          <h4>${escapeHtml(g.title)}</h4>
          <span class="mp-tag">${catIcon(g.category)} ${catName(g.category)} · ${g.question_count} أسئلة · ${g.timer_mode === "age_based" ? "⏱️ مؤقت حسب العمر" : g.time_per_question + "ث لكل سؤال"}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="mp-status ${g.status}">${statusLabel}</span>
          <button class="btn btn-primary" data-join="${g.id}" ${g.status === "finished" ? "disabled" : ""}>انضمام</button>
        </div>
      `;
      wrap.appendChild(el);
    });

    wrap.querySelectorAll("[data-join]").forEach(btn => {
      btn.addEventListener("click", () => join(btn.dataset.join, player));
    });
  }

  async function join(gameId, player){
    const games = await QV.getGames();
    currentGame = games.find(g => g.id === gameId);
    if (!currentGame) return;

    currentPlayerAge = ageGroupToRange(player.age).min;
    await QV.joinGame(gameId, { name: player.name, age: player.age, avatar: player.avatar, user_id: player.userId, score: 0 });
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
    QuizEngine.start({
      category: currentGame.category,
      timePerQuestion,
      questions,
      onFinish: (result) => window.onQuizFinished(result, true, currentGame.id),
    });
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  return { renderList, join, get currentGame(){ return currentGame; } };
})();
