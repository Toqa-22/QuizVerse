/* =========================================================
   🏁 وضع الماراثون (Marathon Mode) — حدث بقاء تنافسي مباشر.

   نظرًا لعدم وجود أي خادم أو دالة سحابية مركزية "تدفع" الأسئلة تباعًا لكل
   اللاعبين في هذا المشروع، يُحسب "السؤال الحالي" بشكل حتمي بحت من الزمن
   الفعلي المنقضي منذ actual_start_at (اللحظة التي ضغط فيها المشرف "ابدأ
   الآن") مقسومًا على مدة كل سؤال — فيتفق تلقائيًا كل المتصلين (لاعبين
   ومتفرجين) على نفس السؤال في نفس اللحظة، بلا أي تنسيق مركزي إضافي.
   عدد "اللاعبين المتبقّين" وقوائم المتصدّرين الحيّة تُحدَّث عبر اشتراك
   Supabase Realtime على جدول marathon_players (بديل polling في وضع العرض
   التجريبي المحلي، تمامًا كآلية غرف اللعب الجماعي الحالية).
   
   ========================================================= */
const Marathon = (function(){
  const TIMER_CIRC = 2 * Math.PI * 26;

  // بطاقة الإعلان على لوحة اللاعب
  let activeMarathon = null;
  let announceTimerHandle = null;
  let announceCountdownHandle = null;
  let announceChannel = null;

  // الماراثون الذي انضم له اللاعب فعليًا (غرفة انتظار/لعب/مشاهدة)
  let currentMarathon = null;
  let currentPlayerObj = null;   // { userId, name, avatar, age }
  let currentPlayerRow = null;   // آخر نسخة معروفة من صف marathon_players الخاص باللاعب

  let waitingChannel = null;
  let waitingCountdownHandle = null;

  let gameTimerHandle = null;
  let gameplayChannel = null;
  let spectatorChannel = null;

  let currentQuestionIndex = -1;
  let answeredCurrentQuestion = true;
  let resolvedTimePerQuestion = 15;
  let myQuestionOrder = [];   // نسخة مُبعثرة خاصة بهذا اللاعب من مجموعة الأسئلة الثابتة —
                               // نفس الأسئلة لكل اللاعبين، لكن كل لاعب يراها بترتيب مختلف
  let mySchedule = [];        // جدول زمني تراكمي خاص بهذا اللاعب (مدة كل سؤال قد تختلف حسب نوعه)

  function init(){
    document.getElementById("btn-marathon-join").addEventListener("click", onClickJoin);
    document.getElementById("btn-marathon-leave-waiting").addEventListener("click", () => leaveWaitingRoom(true));
    document.getElementById("btn-marathon-spectate").addEventListener("click", enterSpectatorMode);
    document.getElementById("btn-marathon-eliminated-leave").addEventListener("click", () => {
      currentMarathon = null; currentPlayerRow = null;
      goTo("screen-dashboard");
    });
    document.getElementById("btn-marathon-spectator-leave").addEventListener("click", () => leaveSpectatorMode(true));
    document.getElementById("btn-mr-leaderboard").addEventListener("click", async () => {
      guardedGoTo("screen-marathon-leaderboard");
      await renderLeaderboard();
    });
    document.getElementById("btn-mr-dashboard").addEventListener("click", async () => {
      currentMarathon = null; currentPlayerRow = null;
      await renderDashboard(); goTo("screen-dashboard");
    });
  }

  /* ---------------- بطاقة الإعلان على لوحة اللاعب ---------------- */
  async function renderDashboardAnnouncement(){
    const card = document.getElementById("marathon-announce-card");
    stopAnnounceTimers();
    const m = await QV.getActiveMarathon();
    activeMarathon = m;
    if (!m){ card.hidden = true; return; }
    card.hidden = false;

    await applyAnnounceState(m);

    // كل تحديث لحظي على الماراثون (حالته، تفعيل/إغلاق التسجيل...) أو على
    // عدد لاعبيه يُعيد تقييم كل شيء من جديد فورًا — وليس فقط عدد المنضمّين
    // كما كان سابقًا. هذا ما يضمن ظهور زر "انضم" لحظة ضغط المشرف "ابدأ
    // الآن" مباشرة، بدل أن يبقى مخفيًا حتى يُحدّث اللاعب الصفحة يدويًا
    // (وبذلك يفوّت جزءًا من نافذة الانضمام العادلة للسؤال الأول)
    announceChannel = QV.subscribeToMarathon(m.id, () => refreshAnnounceState(), "announce");

    // فحص احتياطي كل بضع ثوانٍ حتى لو تأخّر أو فشل وصول حدث Realtime لأي
    // سبب (انقطاع اتصال مؤقت مثلاً) — يبقي حالة البطاقة صحيحة دائمًا
    announceTimerHandle = setInterval(() => refreshAnnounceState(), 4000);
    announceCountdownHandle = setInterval(() => updateAnnounceCountdown(activeMarathon), 1000);
  }

  async function refreshAnnounceState(){
    if (!activeMarathon) return;
    const marathons = await QV.getMarathons();
    const fresh = marathons.find(x => x.id === activeMarathon.id);
    if (!fresh){
      // حُذف الماراثون أو لم يعد "نشطًا" (انتهى مثلاً) — نُعيد التحقق من
      // وجود ماراثون نشط آخر بدل ترك البطاقة عالقة على بيانات قديمة
      const stillActive = await QV.getActiveMarathon();
      activeMarathon = stillActive;
      const card = document.getElementById("marathon-announce-card");
      if (!stillActive){ card.hidden = true; return; }
      card.hidden = false;
    } else {
      activeMarathon = fresh;
    }
    await applyAnnounceState(activeMarathon);
  }

  async function applyAnnounceState(m){
    document.getElementById("marathon-announce-eyebrow").textContent = m.status === "started" ? "🏁 جارٍ الآن" : "🏁 ماراثون قادم";
    document.getElementById("marathon-announce-title").textContent = m.title;
    document.getElementById("marathon-announce-desc").textContent = m.description || "";
    document.getElementById("marathon-announce-date").textContent = formatMarathonDate(m.start_date, m.start_time);

    await refreshAnnouncePlayerCount(m.id);

    const joinBtn = document.getElementById("btn-marathon-join");
    const alreadyBox = document.getElementById("marathon-already-joined");
    const p = AppState.profile;
    const existing = p ? await QV.getMarathonPlayer(m.id, p.id) : null;
    const registrationOpen = m.registration_open !== false;

    if (m.status !== "started" || !registrationOpen){
      // زر الانضمام لا يظهر إطلاقًا قبل أن يضغط المشرف "ابدأ الآن" فعليًا،
      // ولا يظهر أيضًا إن أغلق المشرف باب التسجيل يدويًا (حتى لو كان الحدث
      // جاريًا بالفعل) — لا تسجيل مسبق ولا غرفة انتظار، فقط عدّ تنازلي
      // إعلامي حتى موعد البدء
      joinBtn.hidden = true;
      alreadyBox.hidden = true;
    } else if (existing && !existing.replay_allowed){
      joinBtn.hidden = true;
      alreadyBox.hidden = false;
      document.getElementById("marathon-already-joined-stats").innerHTML = `
        <span>الترتيب: ${existing.rank ? "#" + existing.rank : "—"}</span>
        <span>الأسئلة المُجابة: ${existing.questions_answered || 0}</span>
        <span>نقاط الماراثون: ${existing.marathon_score || 0}</span>
      `;
    } else {
      // الحدث بدأ فعليًا وباب التسجيل مفتوح — يظهر الزر الآن. المشرف "يقبل"
      // انضمام أي لاعب في أي وقت أثناء الحدث؛ إن انضم مبكرًا (لا يزال ضمن
      // نافذة السؤال الأول) يلعب فعليًا، وإلا يدخل مباشرة كمتفرّج فقط
      // (راجع onClickJoin)
      joinBtn.hidden = false;
      alreadyBox.hidden = true;
    }

    updateAnnounceCountdown(m);
  }

  function updateAnnounceCountdown(m){
    const el = document.getElementById("marathon-announce-countdown");
    if (!el) return;
    if (m.status === "started"){ el.textContent = "🔴 مباشر الآن"; return; }
    const diff = new Date(m.start_date + "T" + m.start_time) - new Date();
    el.textContent = diff > 0 ? formatDuration(diff) : "يبدأ الآن...";
  }

  async function refreshAnnouncePlayerCount(marathonId){
    const players = await QV.getMarathonPlayers(marathonId);
    const el = document.getElementById("marathon-announce-players");
    if (el) el.textContent = players.length;
  }

  function stopAnnounceTimers(){
    clearInterval(announceTimerHandle); announceTimerHandle = null;
    clearInterval(announceCountdownHandle); announceCountdownHandle = null;
    if (announceChannel){ QV.unsubscribe(announceChannel); announceChannel = null; }
  }

  /* ---------------- الانضمام وغرفة الانتظار ---------------- */
  async function onClickJoin(){
    if (!activeMarathon || !AppState.profile) return;
    const p = AppState.profile;

    // زر الانضمام لا يظهر أصلاً قبل بدء الحدث أو إن أغلق المشرف باب التسجيل
    // (راجع renderDashboardAnnouncement)، لكن هذا تحقّق دفاعي إضافي احتياطًا
    if (activeMarathon.status !== "started"){
      showToast("لم يبدأ الماراثون بعد");
      return;
    }
    if (activeMarathon.registration_open === false){
      showToast("أغلق المشرف باب التسجيل لهذا الماراثون");
      return;
    }

    const existing = await QV.getMarathonPlayer(activeMarathon.id, p.id);
    if (existing && !existing.replay_allowed){
      showToast("لقد شاركت في هذا الماراثون من قبل");
      return;
    }

    currentMarathon = activeMarathon;
    currentPlayerObj = { userId: p.id, name: p.username, avatar: p.avatar, age: p.age };
    QVSound.click();
    // نوقف اشتراك بطاقة الإعلان على لوحة اللاعب الآن — لم نعد بحاجته أثناء
    // اللعب أو المشاهدة، ويمنع إبقاءه أي استهلاك غير ضروري لاتصال الوقت
    // الفعلي (كما كان سيسبب سابقًا خطأ "channel already subscribed" لو
    // تصادم اسم القناة مع اشتراك اللعب — راجع subscribeToMarathon)
    stopAnnounceTimers();

    // أي لاعب ينضم في أي وقت أثناء الحدث يلعب فعليًا (وليس مجرد مشاهدة) —
    // الشرط الوحيد لإتاحة الانضمام هو أن يكون الماراثون قد بدأ فعلاً وأن
    // يكون المشرف لم يُغلق باب التسجيل يدويًا (تحقّقان أعلاه). لا يوجد أي
    // قيد زمني إضافي على "نافذة السؤال الأول" بعد الآن — إن انضم لاعب
    // متأخرًا، يدخل مباشرة على أي سؤال يعرضه الجدول الزمني الحالي لحظتها
    // ويكمل من هناك، تمامًا كأي لاعب آخر منضمّ.
    try{
      currentPlayerRow = await QV.joinMarathon(currentMarathon.id, currentPlayerObj);
      showToast("🏁 انضممت للماراثون! بالتوفيق 🍀");
      await startGameplayLoop(true);
    }catch(err){
      showToast(err.message || "تعذّر الانضمام للماراثون");
    }
  }

  async function enterWaitingRoom(){
    guardedGoTo("screen-marathon-waiting");
    document.getElementById("mw-title").textContent = currentMarathon.title;
    await refreshWaitingCount();
    waitingChannel = QV.subscribeToMarathon(currentMarathon.id, onWaitingRoomChange, "waiting");
    updateWaitingCountdownText();
    waitingCountdownHandle = setInterval(updateWaitingCountdownText, 1000);
  }

  async function onWaitingRoomChange(){
    await refreshWaitingCount();
    const marathons = await QV.getMarathons();
    const fresh = marathons.find(x => x.id === currentMarathon.id);
    if (fresh && fresh.status === "started"){
      currentMarathon = fresh;
      leaveWaitingRoom(false);
      beginMarathonCountdownAndPlay();
    }
  }

  async function refreshWaitingCount(){
    const players = await QV.getMarathonPlayers(currentMarathon.id);
    const el = document.getElementById("mw-players-count");
    if (el) el.textContent = players.length;
  }

  function updateWaitingCountdownText(){
    const el = document.getElementById("mw-countdown-text");
    if (!el || !currentMarathon) return;
    const diff = new Date(currentMarathon.start_date + "T" + currentMarathon.start_time) - new Date();
    el.textContent = diff > 0 ? "يبدأ خلال " + formatDuration(diff) : "على وشك البدء...";
  }

  function leaveWaitingRoom(goBack){
    if (waitingChannel){ QV.unsubscribe(waitingChannel); waitingChannel = null; }
    clearInterval(waitingCountdownHandle); waitingCountdownHandle = null;
    if (goBack){ currentMarathon = null; currentPlayerRow = null; goTo("screen-dashboard"); }
  }

  /* ---------------- عدّ تنازلي البدء ثم اللعب الفعلي ---------------- */
  async function beginMarathonCountdownAndPlay(){
    goTo("screen-marathon-quiz");
    await playQuizCountdown(); // يُعاد استخدام نفس عدّاد 3-2-1-GO! الموجود مسبقًا للاختبارات العادية
    await startGameplayLoop();
  }

  /* skipIntro=true: يُستخدم عند انضمام لاعب بعد أن ضغط المشرف "ابدأ الآن"
     فعليًا (لا غرفة انتظار ولا عدّ تنازلي مشترك بعد الآن — كل لاعب ينضم في
     أي لحظة يختارها بنفسه) — ننتقل مباشرة للعب فورًا دون أي تأخير إضافي
     يُهدر من وقته العادل ضمن نافذة السؤال الأول */
  async function startGameplayLoop(skipIntro){
    clearInterval(gameTimerHandle);
    if (skipIntro) goTo("screen-marathon-quiz");
    resolvedTimePerQuestion = currentMarathon.use_age_based_timer
      ? await QV.resolveQuestionTimer({ age: ageGroupToRange(currentPlayerObj.age).min, category: currentMarathon.category })
      : (currentMarathon.time_per_question || 15);

    // كل لاعب يحصل على نفس مجموعة الأسئلة تمامًا، لكن بترتيب مُبعثر خاص به
    // وحده (مزيج الفئات + خيارات كل سؤال تُخلط أيضًا بشكل مستقل عند عرضها) —
    // بلا أي تكرار لنفس السؤال طالما لم تُستنفد المجموعة بأكملها بعد
    myQuestionOrder = QV.shuffle((currentMarathon.question_set || []).slice());
    // جدول زمني تراكمي: كل سؤال قد تكون مدته مختلفة عن غيره إن فعّل المشرف
    // "⏱️ وقت مخصص" مع مدة مستقلة لكل نوع سؤال (راجع durationForQuestion) —
    // في وضع "🎂 حسب العمر" تبقى كل الأسئلة بنفس المدة الموحّدة كالسابق تمامًا
    mySchedule = buildQuestionSchedule(myQuestionOrder);

    answeredCurrentQuestion = true;
    currentQuestionIndex = -1;
    tickMarathon();
    gameTimerHandle = setInterval(tickMarathon, 250);

    gameplayChannel = QV.subscribeToMarathon(currentMarathon.id, refreshRemainingCount, "play");
    refreshRemainingCount();
  }

  /* مدة سؤال واحد بعينه: في وضع العمر تكون موحّدة لكل الأسئلة، وفي الوضع
     المخصص تعتمد على نوع هذا السؤال تحديدًا (اختيار من متعدد / صح-خطأ) */
  function durationForQuestion(q){
    if (currentMarathon.use_age_based_timer) return resolvedTimePerQuestion;
    const type = ["true_false", "matching", "ordering"].includes(q.type) ? q.type : "multiple_choice";
    const perType = currentMarathon.custom_type_timers || {};
    return perType[type] || currentMarathon.time_per_question || 15;
  }

  function buildQuestionSchedule(order){
    let cursor = 0;
    return order.map(q => {
      const duration = durationForQuestion(q);
      cursor += duration;
      return { question: q, duration, startsAt: cursor - duration, endsAt: cursor };
    });
  }

  async function tickMarathon(){
    if (!currentMarathon || !currentMarathon.actual_start_at) return;
    const elapsed = (Date.now() - new Date(currentMarathon.actual_start_at).getTime()) / 1000;
    let idx = mySchedule.findIndex(entry => elapsed < entry.endsAt);
    if (idx === -1) idx = mySchedule.length;

    if (idx === currentQuestionIndex){
      const entry = mySchedule[idx];
      if (entry) updateMarathonTimerUI(entry.duration, elapsed - entry.startsAt);
      return;
    }

    if (currentQuestionIndex >= 0 && !answeredCurrentQuestion){
      await eliminatePlayer(false);
      return;
    }

    if (idx >= mySchedule.length){
      if (currentQuestionIndex === -1){
        // انضم بعد أن استُنفدت كل الأسئلة فعليًا (لم يُجب على أي سؤال إطلاقًا) —
        // لا يستحق نتيجة "صمد حتى النهاية"؛ نُصحّح حالته في السجل حتى لا
        // يُصنَّف عند حسم الترتيب النهائي كـ"ناجٍ" رغم عدم لعبه شيئًا، وننقله
        // مباشرة لوضع المشاهدة بدل منحه فوزًا لم يلعبه
        clearInterval(gameTimerHandle); gameTimerHandle = null;
        if (gameplayChannel){ QV.unsubscribe(gameplayChannel); gameplayChannel = null; }
        if (currentPlayerRow && currentPlayerRow.id){
          try{ await QV.updateMarathonPlayer(currentPlayerRow.id, { status: "spectating" }); }catch(e){ /* ignore */ }
        }
        showToast("انتهت أسئلة الماراثون بالفعل — يمكنك مشاهدة النتائج الحية فقط الآن");
        await enterSpectatorMode();
        return;
      }
      await survivedWholePool();
      return;
    }

    currentQuestionIndex = idx;
    answeredCurrentQuestion = false;
    renderMarathonQuestion(mySchedule[idx].question);
  }

  function renderMarathonQuestion(q){
    document.getElementById("mq-counter").textContent = `سؤال ${currentQuestionIndex + 1}`;
    document.getElementById("mq-category-badge").textContent = `${catIcon(q.category)} ${catName(q.category)}`;
    document.getElementById("mq-text").textContent = q.question;
    document.getElementById("mq-survived").textContent = currentQuestionIndex;

    const checkBtn = document.getElementById("mq-check-answer");
    checkBtn.hidden = true;
    checkBtn.onclick = null;

    const type = q.type || "multiple_choice";
    if (type === "matching") { renderMarathonMatching(q); return; }
    if (type === "ordering") { renderMarathonOrdering(q); return; }
    renderMarathonChoice(q, type);
  }

  /* ---------------- 1) اختيار من متعدد / صح-خطأ (تقييم فوري عند الضغط) ---------------- */
  function renderMarathonChoice(q, type){
    const grid = document.getElementById("mq-options-grid");
    grid.innerHTML = "";
    grid.className = "options-grid" + (type === "true_false" ? " options-grid--tf" : "");

    let opts;
    if (type === "true_false"){
      opts = [
        { text: "صح", isCorrect: Number(q.correct_answer) === 1, tf: 1 },
        { text: "خطأ", isCorrect: Number(q.correct_answer) === 2, tf: 2 },
      ];
    } else {
      const raw = [
        { text: q.option1, isCorrect: Number(q.correct_answer) === 1 },
        { text: q.option2, isCorrect: Number(q.correct_answer) === 2 },
        { text: q.option3, isCorrect: Number(q.correct_answer) === 3 },
        { text: q.option4, isCorrect: Number(q.correct_answer) === 4 },
      ];
      opts = QV.shuffle(raw.slice());
    }

    const letters = ["أ", "ب", "ج", "د"];
    opts.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-btn" + (type === "true_false" ? " option-btn--tf" : "");
      btn.innerHTML = type === "true_false"
        ? `<span class="opt-letter">${opt.tf === 1 ? "✔" : "✖"}</span><span>${opt.text}</span>`
        : `<span class="opt-letter">${letters[i]}</span><span>${escapeHtmlLocal(opt.text)}</span>`;
      btn.addEventListener("click", () => onMarathonChoiceAnswer(opt.isCorrect, btn, grid));
      grid.appendChild(btn);
    });
  }

  async function onMarathonChoiceAnswer(isCorrect, btnEl, grid){
    if (answeredCurrentQuestion) return;
    answeredCurrentQuestion = true;
    Array.from(grid.children).forEach(b => { b.disabled = true; });
    if (isCorrect) btnEl.classList.add("correct"); else btnEl.classList.add("wrong");
    await resolveMarathonAnswer(isCorrect);
  }

  /* ---------------- 2) مطابقة (سحب وإفلات — نفس أسلوب الاختبار العادي) ----------------
     البقاء في الماراثون يتطلّب مطابقة كل الأزواج بشكل صحيح (بلا نقاط جزئية،
     تماشيًا مع طبيعة وضع البقاء: أي خطأ يُقصي اللاعب فورًا). */
  function renderMarathonMatching(q){
    const grid = document.getElementById("mq-options-grid");
    grid.innerHTML = "";
    grid.className = "options-grid options-grid--match";

    const wrap = document.createElement("div");
    wrap.className = "match-wrap";

    const leftCol = document.createElement("div");
    leftCol.className = "match-left";
    leftCol.id = "mq-match-left";
    (q.pairs || []).forEach((pair, i) => {
      const row = document.createElement("div");
      row.className = "match-row";
      const label = document.createElement("span");
      label.className = "match-left-label";
      label.textContent = pair.left;
      const zone = document.createElement("span");
      zone.className = "match-drop-zone";
      zone.dataset.leftIndex = String(i);
      zone.textContent = "اسحب الإجابة هنا";
      row.appendChild(label);
      row.appendChild(zone);
      leftCol.appendChild(row);
    });

    const bank = document.createElement("div");
    bank.className = "match-bank";
    bank.id = "mq-match-bank";
    const shuffledRights = QV.shuffle((q.pairs || []).map(p => p.right).slice());
    shuffledRights.forEach(r => {
      const chip = document.createElement("div");
      chip.className = "match-chip";
      chip.dataset.value = r;
      chip.textContent = r;
      bank.appendChild(chip);
    });

    wrap.appendChild(leftCol);
    wrap.appendChild(bank);
    grid.appendChild(wrap);

    initMarathonMatchingDrag();

    const checkBtn = document.getElementById("mq-check-answer");
    checkBtn.hidden = false;
    checkBtn.disabled = true;
    checkBtn.textContent = "تحقق من الإجابة";
    checkBtn.onclick = () => submitMarathonMatching(q);
  }

  function initMarathonMatchingDrag(){
    const bank = document.getElementById("mq-match-bank");
    const zones = Array.from(document.querySelectorAll("#mq-match-left .match-drop-zone"));
    const checkBtn = document.getElementById("mq-check-answer");

    function updateCheckButtonState(){
      checkBtn.disabled = !zones.every(z => z.dataset.assigned);
    }

    function wireChip(chip){
      chip.addEventListener("pointerdown", (e) => {
        if (answeredCurrentQuestion) return;
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const rect = chip.getBoundingClientRect();
        try{ chip.setPointerCapture(e.pointerId); }catch(err){ /* ignore */ }
        chip.classList.add("dragging");
        chip.style.position = "fixed";
        chip.style.left = rect.left + "px";
        chip.style.top = rect.top + "px";
        chip.style.width = rect.width + "px";
        chip.style.zIndex = 60;

        const onMove = (ev) => {
          chip.style.left = (rect.left + (ev.clientX - startX)) + "px";
          chip.style.top = (rect.top + (ev.clientY - startY)) + "px";
          zones.forEach(z => z.classList.remove("drag-over"));
          const target = document.elementFromPoint(ev.clientX, ev.clientY);
          const zone = target && target.closest(".match-drop-zone");
          if (zone) zone.classList.add("drag-over");
        };
        const onUp = (ev) => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          try{ chip.releasePointerCapture(ev.pointerId); }catch(err){ /* ignore */ }
          chip.classList.remove("dragging");
          chip.style.position = ""; chip.style.left = ""; chip.style.top = ""; chip.style.width = ""; chip.style.zIndex = "";
          const target = document.elementFromPoint(ev.clientX, ev.clientY);
          const zone = target && target.closest(".match-drop-zone");
          zones.forEach(z => z.classList.remove("drag-over"));
          if (zone && !answeredCurrentQuestion) assignChipToZone(chip, zone);
          updateCheckButtonState();
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });
    }

    function assignChipToZone(chip, zone){
      if (zone.dataset.assigned){
        const returned = document.createElement("div");
        returned.className = "match-chip";
        returned.dataset.value = zone.dataset.assigned;
        returned.textContent = zone.dataset.assigned;
        bank.appendChild(returned);
        wireChip(returned);
      }
      zone.dataset.assigned = chip.dataset.value;
      zone.textContent = chip.dataset.value;
      zone.classList.add("filled");
      chip.remove();
    }

    bank.querySelectorAll(".match-chip").forEach(wireChip);
    updateCheckButtonState();
  }

  async function submitMarathonMatching(q){
    if (answeredCurrentQuestion) return;
    answeredCurrentQuestion = true;
    const zones = Array.from(document.querySelectorAll("#mq-match-left .match-drop-zone"));
    let allCorrect = zones.length > 0;
    zones.forEach(zone => {
      const leftIndex = Number(zone.dataset.leftIndex);
      const correctValue = (q.pairs || [])[leftIndex] ? q.pairs[leftIndex].right : null;
      const isRight = zone.dataset.assigned === correctValue;
      zone.classList.add(isRight ? "correct" : "wrong");
      if (!isRight) allCorrect = false;
    });
    document.querySelectorAll("#mq-match-bank .match-chip").forEach(c => c.classList.add("dim"));
    document.getElementById("mq-check-answer").hidden = true;
    await resolveMarathonAnswer(allCorrect);
  }

  /* ---------------- 3) ترتيب (أزرار ⬆️/⬇️) ----------------
     يتطلّب البقاء ترتيبًا صحيحًا بالكامل — بلا نقاط جزئية، خلافًا للاختبار
     العادي، تماشيًا مع قاعدة "أي خطأ يُقصي" في وضع البقاء. */
  function renderMarathonOrdering(q){
    const grid = document.getElementById("mq-options-grid");
    grid.innerHTML = "";
    grid.className = "options-grid options-grid--order";
    const shuffled = QV.shuffle((q.ordered_items || []).slice());
    buildMarathonOrderList(shuffled);

    const checkBtn = document.getElementById("mq-check-answer");
    checkBtn.hidden = false;
    checkBtn.disabled = false;
    checkBtn.textContent = "تحقق من الترتيب";
    checkBtn.onclick = () => submitMarathonOrdering(q);
  }

  function buildMarathonOrderList(items, highlightIndexes){
    const list = document.createElement("div");
    list.className = "order-list";
    list.id = "mq-order-list";

    items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "order-item";
      row.dataset.value = item;
      if (highlightIndexes && highlightIndexes.includes(i)) row.classList.add("order-swapped");

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "order-move-btn order-move-up";
      upBtn.textContent = "⬆️";
      upBtn.setAttribute("aria-label", "نقل العنصر للأعلى");
      upBtn.disabled = i === 0;
      upBtn.addEventListener("click", () => moveMarathonOrderItem(i, -1));

      const text = document.createElement("span");
      text.className = "order-text";
      text.textContent = item;

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "order-move-btn order-move-down";
      downBtn.textContent = "⬇️";
      downBtn.setAttribute("aria-label", "نقل العنصر للأسفل");
      downBtn.disabled = i === items.length - 1;
      downBtn.addEventListener("click", () => moveMarathonOrderItem(i, 1));

      row.appendChild(upBtn);
      row.appendChild(text);
      row.appendChild(downBtn);
      list.appendChild(row);
    });

    const grid = document.getElementById("mq-options-grid");
    grid.innerHTML = "";
    grid.appendChild(list);
  }

  function moveMarathonOrderItem(index, direction){
    if (answeredCurrentQuestion) return;
    const oldList = document.getElementById("mq-order-list");
    const items = Array.from(oldList.querySelectorAll(".order-item")).map(el => el.dataset.value);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= items.length) return;

    [items[index], items[newIndex]] = [items[newIndex], items[index]];
    QVSound.click();
    buildMarathonOrderList(items, [index, newIndex]);

    setTimeout(() => {
      document.querySelectorAll("#mq-order-list .order-swapped").forEach(el => el.classList.remove("order-swapped"));
    }, 350);
  }

  async function submitMarathonOrdering(q){
    if (answeredCurrentQuestion) return;
    answeredCurrentQuestion = true;
    const list = document.getElementById("mq-order-list");
    const playerOrder = Array.from(list.querySelectorAll(".order-item")).map(el => el.dataset.value);
    const correctOrder = q.ordered_items || [];
    let allCorrect = playerOrder.length > 0;

    Array.from(list.querySelectorAll(".order-item")).forEach((row, i) => {
      const isRight = playerOrder[i] === correctOrder[i];
      row.classList.add(isRight ? "correct" : "wrong");
      row.querySelectorAll(".order-move-btn").forEach(b => { b.disabled = true; });
      if (!isRight) allCorrect = false;
    });

    document.getElementById("mq-check-answer").hidden = true;
    await resolveMarathonAnswer(allCorrect);
  }

  /* ---------------- نقطة تسوية مشتركة لكل الأنواع الأربعة ---------------- */
  async function resolveMarathonAnswer(isCorrect){
    if (isCorrect){
      QVSound.correct();
      fireConfettiBurst(14);
      spawnMarathonFloating("🔥 لا زلت صامدًا!", "reward");
    } else {
      QVSound.wrong();
      if (navigator.vibrate) navigator.vibrate(180);
    }

    const survivedSeconds = (Date.now() - new Date(currentMarathon.actual_start_at).getTime()) / 1000;
    currentPlayerRow = await QV.recordMarathonAnswer(currentMarathon.id, currentPlayerObj.userId, { correct: isCorrect, survivedSeconds });
    const streakEl = document.getElementById("mq-streak");
    if (streakEl) streakEl.textContent = (currentPlayerRow && currentPlayerRow.current_streak) || 0;

    if (!isCorrect){
      setTimeout(() => eliminatePlayer(true), 750);
    }
  }

  async function eliminatePlayer(alreadyRecorded){
    clearInterval(gameTimerHandle); gameTimerHandle = null;
    if (gameplayChannel){ QV.unsubscribe(gameplayChannel); gameplayChannel = null; }

    if (!alreadyRecorded){
      const survivedSeconds = (Date.now() - new Date(currentMarathon.actual_start_at).getTime()) / 1000;
      currentPlayerRow = await QV.recordMarathonAnswer(currentMarathon.id, currentPlayerObj.userId, { correct: false, survivedSeconds });
      QVSound.eliminated();
    } else {
      QVSound.eliminated();
    }

    const summary = currentPlayerRow || {};
    document.getElementById("me-summary").textContent =
      `صمدت لـ ${summary.questions_answered || 0} سؤالاً، بأعلى سلسلة 🔥 ${summary.highest_streak || 0}`;
    goTo("screen-marathon-eliminated");
  }

  async function survivedWholePool(){
    clearInterval(gameTimerHandle); gameTimerHandle = null;
    if (gameplayChannel){ QV.unsubscribe(gameplayChannel); gameplayChannel = null; }
    const survivedSeconds = (Date.now() - new Date(currentMarathon.actual_start_at).getTime()) / 1000;
    currentPlayerRow = await QV.finishMarathonSurvivor(currentMarathon.id, currentPlayerObj.userId, survivedSeconds);
    QVSound.win();
    showToast("🏁 صمدت حتى نهاية كل الأسئلة! بانتظار إعلان النتائج النهائية من المشرف");
    goTo("screen-dashboard");
  }

  async function refreshRemainingCount(){
    if (!currentMarathon) return;
    const players = await QV.getMarathonPlayers(currentMarathon.id);
    const remaining = players.filter(p => p.status === "alive").length;
    const el = document.getElementById("mq-remaining");
    if (el) el.textContent = remaining;
  }

  function updateMarathonTimerUI(questionDuration, elapsedInQuestion){
    const remaining = Math.max(0, Math.ceil(questionDuration - elapsedInQuestion));
    const ratio = Math.max(0, (questionDuration - elapsedInQuestion) / questionDuration);
    const arc = document.getElementById("mq-timer-arc");
    const val = document.getElementById("mq-timer-value");
    if (arc){ arc.style.strokeDashoffset = TIMER_CIRC * (1 - ratio); arc.classList.toggle("low", remaining <= 5); }
    if (val) val.textContent = remaining;
  }

  /* ---------------- وضع المشاهدة (بعد الإقصاء) ---------------- */
  async function enterSpectatorMode(){
    goTo("screen-marathon-spectator");
    await refreshSpectatorView();
    spectatorChannel = QV.subscribeToMarathon(currentMarathon.id, refreshSpectatorView, "spectate");
  }

  async function refreshSpectatorView(){
    if (!currentMarathon) return;
    const players = await QV.getMarathonPlayers(currentMarathon.id);
    const remaining = players.filter(p => p.status === "alive");
    const remEl = document.getElementById("ms-remaining");
    if (remEl) remEl.textContent = remaining.length;

    const leaders = players.slice()
      .sort((a, b) => (b.highest_streak || 0) - (a.highest_streak || 0) || (b.questions_answered || 0) - (a.questions_answered || 0))
      .slice(0, 10);
    const list = document.getElementById("ms-leaders-list");
    if (list){
      list.innerHTML = leaders.length ? leaders.map((p, i) => `
        <li class="lb-row${i < 3 ? " top-3 rank-" + (i + 1) : ""}">
          <span class="lb-rank">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
          <span class="lb-avatar">${p.avatar || "🙂"}</span>
          <span class="lb-info"><strong>${escapeHtmlLocal(p.username)}</strong><span class="lb-substats">${p.status === "alive" ? "🔥 حيّ الآن" : "💀 مُقصى"} · 🧠 ${p.questions_answered || 0} سؤال</span></span>
          <span class="lb-score">${p.highest_streak || 0}<span class="lb-score-label">أعلى سلسلة</span></span>
        </li>
      `).join("") : `<li class="lb-empty">لا يوجد لاعبون بعد</li>`;
    }

    const marathons = await QV.getMarathons();
    const fresh = marathons.find(x => x.id === currentMarathon.id);
    if (fresh && fresh.status === "finished"){
      leaveSpectatorMode(false);
      await showMarathonResults();
    }
  }

  function leaveSpectatorMode(goBack){
    if (spectatorChannel){ QV.unsubscribe(spectatorChannel); spectatorChannel = null; }
    if (goBack) goTo("screen-dashboard");
  }

  /* ---------------- النتائج النهائية ---------------- */
  async function showMarathonResults(){
    if (!currentMarathon || !currentPlayerObj){ goTo("screen-dashboard"); return; }
    const row = await QV.getMarathonPlayer(currentMarathon.id, currentPlayerObj.userId);
    if (!row){ goTo("screen-dashboard"); return; }
    currentPlayerRow = row;

    const isWinner = row.rank === 1;
    document.getElementById("mr-emoji").textContent = isWinner ? "🏆" : "🏁";
    document.getElementById("mr-title").textContent = isWinner ? "🏆 بطل الماراثون!" : "انتهى الماراثون";
    document.getElementById("mr-subtitle").textContent = currentMarathon.title;
    document.getElementById("mr-rank").textContent = row.rank ? "#" + row.rank : "—";
    document.getElementById("mr-answered").textContent = row.questions_answered || 0;
    document.getElementById("mr-correct").textContent = row.correct_answers || 0;
    document.getElementById("mr-streak").textContent = row.highest_streak || 0;
    document.getElementById("mr-time").textContent = formatMinSec(row.survived_seconds || 0);
    document.getElementById("mr-score").textContent = row.marathon_score || 0;
    document.getElementById("mr-card").classList.toggle("marathon-winner-card", isWinner);

    goTo("screen-marathon-results");
    if (isWinner){ fireConfettiCelebration(); QVSound.win(); }

    try{
      const profile = await QV.getProfile(currentPlayerObj.userId);
      if (profile){
        AppState.profile = profile;
        updateHeaderScore();
        const rank = await QV.getRank(profile.id);
        const { newlyUnlocked } = await QV.syncAchievements(profile, rank);
        if (newlyUnlocked && newlyUnlocked.length){
          QVSound.achievement();
          const names = newlyUnlocked.map(id => (QUIZVERSE_ACHIEVEMENTS.find(a => a.id === id) || {}).name).filter(Boolean);
          if (names.length) setTimeout(() => showToast("إنجاز جديد مفتوح: " + names.join("، ") + " 🏅"), 1200);
        }
      }
    }catch(e){ console.warn("تعذّر مزامنة الملف الشخصي بعد الماراثون", e); }
  }

  /* ---------------- لوحة ترتيب الماراثون (عالمية) ---------------- */
  async function renderLeaderboard(){
    const list = document.getElementById("mlb-list");
    list.innerHTML = `<li class="lb-empty">جارٍ التحميل...</li>`;
    const rows = await QV.getMarathonLeaderboard("all");
    if (!rows.length){
      list.innerHTML = `<li class="lb-empty">لا توجد نتائج ماراثون بعد — كن أول بطل! 🏁</li>`;
      return;
    }
    const myId = QV.getCurrentUserId();
    list.innerHTML = "";
    rows.slice(0, 50).forEach(r => {
      const li = document.createElement("li");
      const medal = r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : null;
      li.className = "lb-row" + (r.rank <= 3 ? " top-3 rank-" + r.rank : "") + (r.id === myId ? " is-me" : "");
      li.innerHTML = `
        <span class="lb-rank">${medal ? `<span class="lb-medal">${medal}</span>` : r.rank}</span>
        <span class="lb-avatar">${r.avatar || "🙂"}</span>
        <span class="lb-info">
          <strong>${escapeHtmlLocal(r.username || "لاعب")}${r.id === myId ? ' <span class="lb-you-tag">أنت</span>' : ""}</strong>
          <span class="lb-substats">🏆 ${r.marathon_wins || 0} فوز · 🔥 أعلى سلسلة ${r.marathon_highest_streak || 0}</span>
        </span>
        <span class="lb-score">${r.marathon_best_score || 0}<span class="lb-score-label">نقطة</span></span>
      `;
      list.appendChild(li);
    });
  }

  /* ---------------- أدوات مساعدة محلية ---------------- */
  function formatDuration(ms){
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
  }

  function formatMinSec(totalSeconds){
    const m = Math.floor(totalSeconds / 60);
    const s = Math.round(totalSeconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function formatMarathonDate(dateStr, timeStr){
    try{
      const d = new Date(dateStr + "T" + timeStr);
      const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
      const hh = d.getHours();
      const mm = String(d.getMinutes()).padStart(2, "0");
      const period = hh >= 12 ? "م" : "ص";
      const hh12 = (hh % 12) || 12;
      return `${days[d.getDay()]} ${hh12}:${mm} ${period}`;
    }catch(e){ return dateStr; }
  }

  function spawnMarathonFloating(text, cls){
    const layer = document.getElementById("mq-floating-layer");
    if (!layer) return;
    const el = document.createElement("div");
    el.className = "floating-reward" + (cls ? " " + cls : "");
    el.textContent = text;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  function escapeHtmlLocal(str){
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  return { init, renderDashboardAnnouncement, renderLeaderboard };
})();
