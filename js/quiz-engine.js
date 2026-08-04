/* =========================================================
   محرك الاختبار: تحميل الأسئلة، المؤقت، شريط التقدم،
   حساب النقاط، والتغذية الراجعة بعد كل إجابة.

   يدعم أربعة أنواع أسئلة: اختيار من متعدد (multiple_choice)،
   صح/خطأ (true_false)، مطابقة (matching)، وترتيب (ordering).
   شريط التقدم وربط الإنجازات/الوضع الجماعي تعمل بنفس الطريقة
   تمامًا لكل الأنواع الأربعة.

   المؤقت: لكل نوع سؤال مدته الخاصة إن كان المشرف قد حدّدها من
   لوحة التحكم (أولوية قصوى، تُقيَّم لكل سؤال على حدة)، وإلا
   تُستخدم القيمة الممرَّرة عند بدء الاختبار (والتي تُحسب مسبقًا
   خارج المحرك حسب عمر اللاعب أو الفئة المعرفية — دون أي تغيير
   في تلك الآلية الحالية).
   ========================================================= */

const QuizEngine = (function(){
  const TIMER_CIRC = 2 * Math.PI * 26; // نفس نصف قطر دائرة SVG (r=26)

  let state = {
    questions: [],
    index: 0,
    score: 0,
    correctCount: 0,
    wrongCount: 0,
    timePerQuestion: 15,
    currentTimePerQuestion: 15,
    typeTimers: null,
    answerTimes: [],
    timerHandle: null,
    remaining: 15,
    locked: false,
    category: null,
    difficulty: null,
    currentType: "multiple_choice",
    onFinish: null,
  };

  const els = {};
  function cacheEls(){
    els.counter = document.getElementById("q-counter");
    els.progressFill = document.getElementById("progress-fill");
    els.timerArc = document.getElementById("timer-arc");
    els.timerValue = document.getElementById("timer-value");
    els.catBadge = document.getElementById("q-category-badge");
    els.qText = document.getElementById("q-text");
    els.optionsGrid = document.getElementById("options-grid");
    els.checkBtn = document.getElementById("btn-check-answer");
    els.feedbackPanel = document.getElementById("feedback-panel");
    els.feedbackIcon = document.getElementById("feedback-icon");
    els.feedbackTitle = document.getElementById("feedback-title");
    els.feedbackExplain = document.getElementById("feedback-explain");
    els.nextBtn = document.getElementById("btn-next-question");
  }

  async function start({ category, difficulty, ageMin, ageMax, count, timePerQuestion, questions, excludeIds, onFinish }){
    cacheEls();
    state.category = category;
    state.difficulty = difficulty;
    state.score = 0;
    state.correctCount = 0;
    state.wrongCount = 0;
    state.index = 0;
    state.answerTimes = [];
    state.timePerQuestion = timePerQuestion || QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION;
    state.onFinish = onFinish;
    state.settings = await QV.getQuizSettings();
    // مؤقت كل نوع سؤال (إن حدّده المشرف) — يُجلب مرة واحدة لكامل الاختبار
    // ثم يُطبَّق تلقائيًا على كل سؤال حسب نوعه عند عرضه
    state.typeTimers = await QV.getQuestionTypeTimers();

    if (questions){
      state.questions = questions;
    } else {
      state.questions = await QV.getQuestions({
        category, ageMin, ageMax, difficulty, excludeIds,
        limit: count || QUIZVERSE_CONFIG.DEFAULT_QUESTIONS_PER_QUIZ,
      });
    }

    if (!state.questions.length){
      showToast("لا توجد أسئلة متاحة لهذا الاختيار حاليًا");
      return false;
    }

    els.nextBtn.onclick = nextQuestion;
    renderQuestion();
    return true;
  }

  /* ---------------- عرض السؤال: يوجّه لدالة العرض المناسبة حسب النوع ---------------- */
  function renderQuestion(){
    els.feedbackPanel.hidden = true;
    els.feedbackPanel.classList.remove("is-correct", "is-wrong", "is-partial");
    els.checkBtn.hidden = true;
    els.checkBtn.disabled = true;
    els.checkBtn.onclick = null;
    state.locked = false;

    const q = state.questions[state.index];
    const type = q.type || "multiple_choice";
    state.currentType = type;
    // مؤقت هذا السؤال تحديدًا: مؤقت النوع إن كان محددًا من المشرف، وإلا
    // القيمة العامة المُحسوبة مسبقًا لهذا الاختبار (عمر/فئة/افتراضي)
    state.currentTimePerQuestion = (state.typeTimers && state.typeTimers[type]) || state.timePerQuestion;

    els.counter.textContent = `${state.index + 1} / ${state.questions.length}`;
    els.progressFill.style.width = ((state.index) / state.questions.length * 100) + "%";
    els.catBadge.textContent = `${catIcon(q.category)} ${catName(q.category)}`;
    els.qText.textContent = q.question;
    els.optionsGrid.innerHTML = "";
    els.optionsGrid.className = "options-grid";

    if (type === "true_false") renderTrueFalse(q);
    else if (type === "matching") renderMatching(q);
    else if (type === "ordering") renderOrdering(q);
    else renderMultipleChoice(q);

    startTimer();
  }

  /* ---------------- 1) اختيار من متعدد (السلوك الأصلي دون أي تغيير) ---------------- */
  function renderMultipleChoice(q){
    const rawOpts = [
      { text: q.option1, isCorrect: Number(q.correct_answer) === 1 },
      { text: q.option2, isCorrect: Number(q.correct_answer) === 2 },
      { text: q.option3, isCorrect: Number(q.correct_answer) === 3 },
      { text: q.option4, isCorrect: Number(q.correct_answer) === 4 },
    ];
    const shuffleAnswers = !state.settings || state.settings.shuffleAnswers !== false;
    const opts = shuffleAnswers ? QV.shuffle(rawOpts.slice()) : rawOpts;
    state.currentCorrectPos = opts.findIndex(o => o.isCorrect) + 1;

    const letters = ["أ","ب","ج","د"];
    opts.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-btn";
      btn.innerHTML = `<span class="opt-letter">${letters[i]}</span><span>${escapeHtml(opt.text)}</span>`;
      btn.addEventListener("click", () => selectAnswer(i + 1, btn));
      els.optionsGrid.appendChild(btn);
    });
  }

  /* ---------------- 2) صح / خطأ ---------------- */
  function renderTrueFalse(q){
    state.currentCorrectPos = Number(q.correct_answer) === 2 ? 2 : 1;
    els.optionsGrid.classList.add("options-grid--tf");

    const opts = [
      { label: "صح", icon: "✔", value: 1 },
      { label: "خطأ", icon: "✖", value: 2 },
    ];
    opts.forEach(o => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-btn option-btn--tf";
      btn.innerHTML = `<span class="opt-letter">${o.icon}</span><span>${o.label}</span>`;
      btn.addEventListener("click", () => selectAnswer(o.value, btn));
      els.optionsGrid.appendChild(btn);
    });
  }

  /* ---------------- 3) مطابقة (سحب وإفلات — بلا تغيير) ---------------- */
  function renderMatching(q){
    els.optionsGrid.classList.add("options-grid--match");

    const wrap = document.createElement("div");
    wrap.className = "match-wrap";

    const leftCol = document.createElement("div");
    leftCol.className = "match-left";
    leftCol.id = "match-left";
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
    bank.id = "match-bank";
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
    els.optionsGrid.appendChild(wrap);

    initMatchingDrag();

    els.checkBtn.hidden = false;
    els.checkBtn.disabled = true;
    els.checkBtn.textContent = "تحقق من الإجابة";
    els.checkBtn.onclick = () => submitMatching(q, { timedOut: false });
  }

  function initMatchingDrag(){
    const bank = document.getElementById("match-bank");
    const zones = Array.from(document.querySelectorAll("#match-left .match-drop-zone"));

    function updateCheckButtonState(){
      els.checkBtn.disabled = !zones.every(z => z.dataset.assigned);
    }

    function wireChip(chip){
      chip.addEventListener("pointerdown", (e) => {
        if (state.locked) return;
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const rect = chip.getBoundingClientRect();
        try{ chip.setPointerCapture(e.pointerId); }catch(err){/* ignore */}
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
          try{ chip.releasePointerCapture(ev.pointerId); }catch(err){/* ignore */}
          chip.classList.remove("dragging");
          chip.style.position = "";
          chip.style.left = ""; chip.style.top = ""; chip.style.width = ""; chip.style.zIndex = "";

          const target = document.elementFromPoint(ev.clientX, ev.clientY);
          const zone = target && target.closest(".match-drop-zone");
          zones.forEach(z => z.classList.remove("drag-over"));

          if (zone && !state.locked) assignChipToZone(chip, zone);
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

  function submitMatching(q, { timedOut }){
    if (state.locked) return;
    state.locked = true;
    clearInterval(state.timerHandle);
    state.answerTimes.push((Date.now() - state.questionStartedAt) / 1000);

    const zones = Array.from(document.querySelectorAll("#match-left .match-drop-zone"));
    let allCorrect = zones.length > 0;
    zones.forEach(zone => {
      const leftIndex = Number(zone.dataset.leftIndex);
      const correctValue = (q.pairs || [])[leftIndex] ? q.pairs[leftIndex].right : null;
      const isRight = zone.dataset.assigned === correctValue;
      zone.classList.add(isRight ? "correct" : "wrong");
      if (!isRight) allCorrect = false;
    });
    document.querySelectorAll("#match-bank .match-chip").forEach(c => c.classList.add("dim"));
    els.checkBtn.hidden = true;

    finalizeAnswer(q, allCorrect, { timedOut });
  }

  /* ---------------- 4) ترتيب — بأزرار ⬆️/⬇️ بدل السحب والإفلات ----------------
     كل ضغطة تحرّك العنصر خطوة واحدة فقط، مع حركة انتقالية بصرية بسيطة،
     ويحصل اللاعب على نقاط جزئية بحسب عدد العناصر في مكانها الصحيح. */
  function renderOrdering(q){
    els.optionsGrid.classList.add("options-grid--order");
    const shuffled = QV.shuffle((q.ordered_items || []).slice());
    buildOrderList(shuffled);

    els.checkBtn.hidden = false;
    els.checkBtn.disabled = false;
    els.checkBtn.textContent = "تحقق من الترتيب";
    els.checkBtn.onclick = () => submitOrdering(q, { timedOut: false });
  }

  function buildOrderList(items, highlightIndexes){
    const list = document.createElement("div");
    list.className = "order-list";
    list.id = "order-list";

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
      upBtn.addEventListener("click", () => moveOrderItem(i, -1));

      const text = document.createElement("span");
      text.className = "order-text";
      text.textContent = item;

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "order-move-btn order-move-down";
      downBtn.textContent = "⬇️";
      downBtn.setAttribute("aria-label", "نقل العنصر للأسفل");
      downBtn.disabled = i === items.length - 1;
      downBtn.addEventListener("click", () => moveOrderItem(i, 1));

      row.appendChild(upBtn);
      row.appendChild(text);
      row.appendChild(downBtn);
      list.appendChild(row);
    });

    els.optionsGrid.innerHTML = "";
    els.optionsGrid.appendChild(list);
  }

  function moveOrderItem(index, direction){
    if (state.locked) return;
    const oldList = document.getElementById("order-list");
    const items = Array.from(oldList.querySelectorAll(".order-item")).map(el => el.dataset.value);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= items.length) return;

    [items[index], items[newIndex]] = [items[newIndex], items[index]];
    QVSound.click();
    buildOrderList(items, [index, newIndex]);

    setTimeout(() => {
      document.querySelectorAll("#order-list .order-swapped").forEach(el => el.classList.remove("order-swapped"));
    }, 350);
  }

  function submitOrdering(q, { timedOut }){
    if (state.locked) return;
    state.locked = true;
    clearInterval(state.timerHandle);
    state.answerTimes.push((Date.now() - state.questionStartedAt) / 1000);

    const list = document.getElementById("order-list");
    const playerOrder = Array.from(list.querySelectorAll(".order-item")).map(el => el.dataset.value);
    const correctOrder = q.ordered_items || [];
    const totalItems = correctOrder.length || 1;

    let correctPositions = 0;
    const rows = Array.from(list.querySelectorAll(".order-item"));
    rows.forEach((row, i) => {
      const isRight = playerOrder[i] === correctOrder[i];
      row.classList.add(isRight ? "correct" : "wrong");
      row.querySelectorAll(".order-move-btn").forEach(b => b.disabled = true);
      if (isRight) correctPositions += 1;
    });

    const fraction = correctPositions / totalItems;
    const isFullyCorrect = fraction === 1;
    const totalPoints = Number(q.points) || 10;
    const pointsEarned = Math.round((totalPoints / totalItems) * correctPositions);

    els.checkBtn.hidden = true;

    finalizeAnswer(q, isFullyCorrect, {
      timedOut,
      pointsOverride: pointsEarned,
      orderDetails: { playerOrder, correctOrder, correctPositions, totalItems },
    });
  }

  /* ---------------- المؤقت (مشترك بين كل الأنواع، بمدة خاصة بكل سؤال) ---------------- */
  function startTimer(){
    clearInterval(state.timerHandle);
    state.remaining = state.currentTimePerQuestion;
    state.questionStartedAt = Date.now();
    updateTimerUI();
    state.timerHandle = setInterval(() => {
      state.remaining -= 1;
      updateTimerUI();
      if (state.remaining <= 5 && state.remaining > 0) QVSound.tick();
      if (state.remaining <= 0){
        clearInterval(state.timerHandle);
        if (state.locked) return;
        const q = state.questions[state.index];
        if (state.currentType === "matching") submitMatching(q, { timedOut: true });
        else if (state.currentType === "ordering") submitOrdering(q, { timedOut: true });
        else selectAnswer(null, null);
      }
    }, 1000);
  }

  function updateTimerUI(){
    const ratio = Math.max(0, state.remaining / state.currentTimePerQuestion);
    els.timerArc.style.strokeDashoffset = TIMER_CIRC * (1 - ratio);
    els.timerArc.classList.toggle("low", state.remaining <= 5);
    els.timerValue.textContent = Math.max(0, state.remaining);
  }

  /* ---------------- اختيار من متعدد / صح-خطأ: تقييم فوري عند الضغط ---------------- */
  function selectAnswer(chosen, btnEl){
    if (state.locked) return;
    state.locked = true;
    clearInterval(state.timerHandle);
    state.answerTimes.push((Date.now() - state.questionStartedAt) / 1000);

    const q = state.questions[state.index];
    const correctNum = state.currentCorrectPos;
    const buttons = Array.from(els.optionsGrid.children);

    buttons.forEach((b, i) => {
      const n = i + 1;
      b.disabled = true;
      if (n === correctNum) b.classList.add("correct");
      else if (n === chosen) b.classList.add("wrong");
      else b.classList.add("dim");
    });

    const isCorrect = chosen === correctNum;
    finalizeAnswer(q, isCorrect, { timedOut: chosen === null });
  }

  /* ---------------- نقطة مشتركة نهائية لكل الأنواع ---------------- */
  function finalizeAnswer(q, isCorrect, { timedOut, orderDetails, pointsOverride } = {}){
    els.feedbackPanel.hidden = false;
    els.progressFill.style.width = ((state.index + 1) / state.questions.length * 100) + "%";

    const fullPoints = Number(q.points) || 10;
    const awardedPoints = pointsOverride != null ? pointsOverride : (isCorrect ? fullPoints : 0);

    if (isCorrect){
      state.score += awardedPoints;
      state.correctCount += 1;
      QVSound.correct();
      els.feedbackPanel.classList.add("is-correct");
      els.feedbackIcon.textContent = "✔";
      els.feedbackTitle.textContent = `إجابة صحيحة! +${awardedPoints} نقطة`;
      els.feedbackExplain.textContent = q.explanation || "";
      fireConfettiBurst();
    } else {
      state.wrongCount += 1;
      if (awardedPoints > 0) state.score += awardedPoints;

      if (awardedPoints > 0) QVSound.correct(); else QVSound.wrong();
      els.feedbackPanel.classList.add(awardedPoints > 0 ? "is-partial" : "is-wrong");
      els.feedbackIcon.textContent = awardedPoints > 0 ? "➗" : "✖";

      if (timedOut){
        els.feedbackTitle.textContent = "انتهى الوقت!";
      } else if (orderDetails && awardedPoints > 0){
        els.feedbackTitle.textContent = `ترتيب جزئي صحيح (${orderDetails.correctPositions} من ${orderDetails.totalItems}) — +${awardedPoints} نقطة`;
      } else {
        els.feedbackTitle.textContent = "إجابة خاطئة";
      }

      let explainText = q.explanation || "";
      if (orderDetails){
        const correctText = "الترتيب الصحيح: " + orderDetails.correctOrder.join(" ← ");
        explainText = explainText ? explainText + " — " + correctText : correctText;
      }
      els.feedbackExplain.textContent = explainText;
    }

    if (typeof state.onAnswer === "function"){
      state.onAnswer({
        questionIndex: state.index, question: q, correct: isCorrect, points: awardedPoints,
      });
    }

    if (timedOut){
      setTimeout(nextQuestion, 1600);
    }
  }

  function nextQuestion(){
    state.index += 1;
    if (state.index >= state.questions.length){
      finish();
      return;
    }
    renderQuestion();
  }

  function finish(){
    clearInterval(state.timerHandle);
    const avgTime = state.answerTimes.length
      ? (state.answerTimes.reduce((a,b) => a+b, 0) / state.answerTimes.length)
      : 0;
    const result = {
      score: state.score,
      correctCount: state.correctCount,
      wrongCount: state.wrongCount,
      total: state.questions.length,
      avgTime: Math.round(avgTime * 10) / 10,
      category: state.category,
      difficulty: state.difficulty,
      questionIds: state.questions.map(q => q.id),
    };
    if (typeof state.onFinish === "function") state.onFinish(result);
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  return { start, get state(){ return state; } };
})();
