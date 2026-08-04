/* =========================================================
   لوحة تحكم المشرف: تسجيل الدخول، إدارة الأسئلة، إدارة
   الغرف الجماعية، وعرض الإحصائيات.
   ========================================================= */

const Admin = (function(){
  let loggedIn = false;
  let currentAdminUsername = null;

  function init(){
    document.getElementById("form-admin-login").addEventListener("submit", onLogin);
    document.getElementById("btn-admin-logout").addEventListener("click", logout);

    document.querySelectorAll(".admin-nav-btn[data-panel]").forEach(btn => {
      btn.addEventListener("click", () => switchPanel(btn.dataset.panel));
    });

    document.getElementById("btn-new-question").addEventListener("click", () => openQuestionModal());
    document.getElementById("form-question").addEventListener("submit", onSaveQuestion);
    document.getElementById("btn-cancel-question").addEventListener("click", () => closeModal("modal-question"));
    document.getElementById("qf-type").addEventListener("change", () => applyQuestionTypeUI(document.getElementById("qf-type").value));
    document.getElementById("btn-add-pair").addEventListener("click", () => addPairRow());
    document.getElementById("btn-add-item").addEventListener("click", () => addItemRow());

    document.getElementById("btn-new-game").addEventListener("click", () => openGameModal());
    document.getElementById("form-game").addEventListener("submit", onSaveGame);
    document.getElementById("btn-cancel-game").addEventListener("click", () => closeModal("modal-game"));
    document.querySelectorAll('input[name="gf-timer-mode"]').forEach(radio => {
      radio.addEventListener("change", () => applyGameTimerModeUI(radio.value));
    });

    document.getElementById("btn-new-age-timer").addEventListener("click", () => openAgeTimerModal());
    document.getElementById("form-age-timer").addEventListener("submit", onSaveAgeTimer);
    document.getElementById("btn-cancel-age-timer").addEventListener("click", () => closeModal("modal-age-timer"));

    document.getElementById("btn-save-settings").addEventListener("click", onSaveSettings);
    document.getElementById("form-admin-password").addEventListener("submit", onChangeAdminPassword);

    populateCategorySelects();
  }

  function populateCategorySelects(){
    const options = QUIZ_CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");
    document.getElementById("qf-category").innerHTML = options;
    document.getElementById("gf-category").innerHTML = options;

    // تعبئة مؤقت الغرفة تلقائيًا بقيمة مؤقت الفئة المُعدّة من قبل المشرف عند اختيارها
    document.getElementById("gf-category").addEventListener("change", async (e) => {
      const timers = await QV.getCategoryTimers();
      const t = timers[e.target.value];
      if (t) document.getElementById("gf-time").value = t;
    });
  }

  async function onLogin(e){
    e.preventDefault();
    const username = document.getElementById("admin-username").value.trim();
    const pass = document.getElementById("admin-pass").value;
    const errEl = document.getElementById("admin-login-err");
    errEl.textContent = "";
    try{
      const result = await QV.adminLogin(username, pass);
      loggedIn = true;
      currentAdminUsername = username;
      if (result && result.bootstrapped){
        showToast("تم إنشاء حساب المشرف الأول بنجاح ✔ احفظ بيانات الدخول جيدًا");
      } else if (QV.isDemoMode){
        showToast("تم الدخول في الوضع التجريبي المحلي ✦");
      }
      goTo("screen-admin");
      switchPanel("panel-stats");
      await Promise.all([renderStats(), renderQuestionsTable(), renderGamesTable(), renderSettingsTable(), renderPlayersTable(), renderAgeTimersTable()]);
    }catch(err){
      errEl.textContent = "بيانات الدخول غير صحيحة، أو الحساب لا يملك صلاحية المشرف.";
    }
  }

  function logout(){
    loggedIn = false;
    currentAdminUsername = null;
    goTo("screen-welcome");
  }

  async function onChangeAdminPassword(e){
    e.preventDefault();
    const errEl = document.getElementById("af-err");
    errEl.textContent = "";
    const oldPass = document.getElementById("af-old-pass").value;
    const newPass = document.getElementById("af-new-pass").value;
    const newPass2 = document.getElementById("af-new-pass2").value;
    if (newPass !== newPass2){
      errEl.textContent = "كلمتا المرور الجديدتان غير متطابقتين";
      return;
    }
    try{
      await QV.changeAdminPassword(currentAdminUsername, oldPass, newPass);
      showToast("تم تحديث كلمة مرور المشرف ✔");
      e.target.reset();
    }catch(err){
      errEl.textContent = err.message || "تعذّر تحديث كلمة المرور";
    }
  }

  function switchPanel(id){
    document.querySelectorAll(".admin-nav-btn[data-panel]").forEach(b => b.classList.toggle("active", b.dataset.panel === id));
    document.querySelectorAll(".admin-panel").forEach(p => p.classList.toggle("active", p.id === id));
  }

  /* ---------------- stats ---------------- */
  async function renderStats(){
    const s = await QV.getStats();
    const grid = document.getElementById("stats-grid");
    grid.innerHTML = `
      <div class="stat-card"><strong>${s.totalPlayers}</strong><span>لاعبون فريدون</span></div>
      <div class="stat-card"><strong>${s.totalQuizzes}</strong><span>اختبارات مكتملة</span></div>
      <div class="stat-card"><strong>${s.totalQuestions}</strong><span>إجمالي الأسئلة</span></div>
      <div class="stat-card"><strong>${s.highestScore}</strong><span>أعلى نتيجة</span></div>
    `;
    document.getElementById("stats-top-category").textContent = s.topCategory;
  }

  /* ---------------- questions ---------------- */
  let editingQuestions = [];
  const TYPE_LABELS = {
    multiple_choice: "اختيار من متعدد",
    true_false: "صح / خطأ",
    matching: "مطابقة",
    ordering: "ترتيب",
  };

  async function renderQuestionsTable(){
    editingQuestions = await QV.getQuestions({});
    const tbody = document.getElementById("questions-tbody");
    tbody.innerHTML = editingQuestions.map(q => `
      <tr>
        <td class="q-cell" data-label="السؤال">${escapeHtml(q.question)}</td>
        <td data-label="النوع">${TYPE_LABELS[q.type] || TYPE_LABELS.multiple_choice}</td>
        <td data-label="الفئة">${catIcon(q.category)} ${catName(q.category)}</td>
        <td data-label="العمر">${q.age_min}-${q.age_max}</td>
        <td data-label="الصعوبة">${{easy:"سهل",medium:"متوسط",hard:"صعب"}[q.difficulty] || q.difficulty}</td>
        <td data-label="النقاط">${q.points}</td>
        <td class="table-actions" data-label="">
          <button data-edit="${q.id}">تعديل</button>
          <button data-del="${q.id}" class="danger">حذف</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">لا توجد أسئلة بعد</td></tr>`;

    tbody.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openQuestionModal(editingQuestions.find(q => q.id === b.dataset.edit))));
    tbody.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => onDeleteQuestion(b.dataset.del)));
  }

  /* ---------------- إظهار/إخفاء حقول النموذج حسب نوع السؤال المختار ---------------- */
  function applyQuestionTypeUI(type){
    document.getElementById("qf-group-mc").hidden = type !== "multiple_choice";
    document.getElementById("qf-group-tf").hidden = type !== "true_false";
    document.getElementById("qf-group-matching").hidden = type !== "matching";
    document.getElementById("qf-group-ordering").hidden = type !== "ordering";
  }

  /* ---------------- صفوف أزواج المطابقة الديناميكية ---------------- */
  function addPairRow(left = "", right = ""){
    const wrap = document.getElementById("qf-pairs-list");
    const row = document.createElement("div");
    row.className = "pair-row";

    const leftInput = document.createElement("input");
    leftInput.type = "text";
    leftInput.className = "qf-pair-left";
    leftInput.placeholder = "العنصر";
    leftInput.value = left;

    const arrow = document.createElement("span");
    arrow.className = "pair-arrow";
    arrow.textContent = "→";

    const rightInput = document.createElement("input");
    rightInput.type = "text";
    rightInput.className = "qf-pair-right";
    rightInput.placeholder = "الإجابة الصحيحة";
    rightInput.value = right;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-remove-row";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => row.remove());

    row.appendChild(leftInput);
    row.appendChild(arrow);
    row.appendChild(rightInput);
    row.appendChild(removeBtn);
    wrap.appendChild(row);
  }

  /* ---------------- صفوف عناصر الترتيب الديناميكية ---------------- */
  function addItemRow(value = ""){
    const wrap = document.getElementById("qf-items-list");
    const row = document.createElement("div");
    row.className = "item-row";

    const badge = document.createElement("span");
    badge.className = "item-order-badge";
    badge.textContent = String(wrap.children.length + 1);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "qf-item-value";
    input.placeholder = "العنصر";
    input.value = value;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-remove-row";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      row.remove();
      renumberItemRows();
    });

    row.appendChild(badge);
    row.appendChild(input);
    row.appendChild(removeBtn);
    wrap.appendChild(row);
  }

  function renumberItemRows(){
    document.querySelectorAll("#qf-items-list .item-row").forEach((row, i) => {
      row.querySelector(".item-order-badge").textContent = String(i + 1);
    });
  }

  function openQuestionModal(q){
    document.getElementById("question-modal-title").textContent = q ? "تعديل السؤال" : "سؤال جديد";
    document.getElementById("qf-id").value = q ? q.id : "";
    document.getElementById("qf-text").value = q ? q.question : "";

    const type = q ? (q.type || "multiple_choice") : "multiple_choice";
    document.getElementById("qf-type").value = type;
    applyQuestionTypeUI(type);

    document.getElementById("qf-opt1").value = q ? (q.option1 || "") : "";
    document.getElementById("qf-opt2").value = q ? (q.option2 || "") : "";
    document.getElementById("qf-opt3").value = q ? (q.option3 || "") : "";
    document.getElementById("qf-opt4").value = q ? (q.option4 || "") : "";
    document.getElementById("qf-correct").value = (q && q.correct_answer) ? q.correct_answer : "1";

    const tfValue = (q && type === "true_false" && Number(q.correct_answer) === 2) ? "2" : "1";
    document.querySelector(`input[name="qf-tf"][value="${tfValue}"]`).checked = true;

    document.getElementById("qf-pairs-list").innerHTML = "";
    if (type === "matching" && q && Array.isArray(q.pairs) && q.pairs.length){
      q.pairs.forEach(p => addPairRow(p.left, p.right));
    } else {
      addPairRow(); addPairRow();
    }

    document.getElementById("qf-items-list").innerHTML = "";
    if (type === "ordering" && q && Array.isArray(q.ordered_items) && q.ordered_items.length){
      q.ordered_items.forEach(item => addItemRow(item));
    } else {
      addItemRow(); addItemRow();
    }

    document.getElementById("qf-category").value = q ? q.category : QUIZ_CATEGORIES[0].id;
    document.getElementById("qf-difficulty").value = q ? q.difficulty : "medium";
    document.getElementById("qf-age-min").value = q ? q.age_min : 5;
    document.getElementById("qf-age-max").value = q ? q.age_max : 99;
    document.getElementById("qf-points").value = q ? q.points : 10;
    document.getElementById("qf-explain").value = q ? (q.explanation || "") : "";
    openModal("modal-question");
  }

  async function onSaveQuestion(e){
    e.preventDefault();
    const id = document.getElementById("qf-id").value || null;
    const type = document.getElementById("qf-type").value;

    const payload = {
      id: id || undefined,
      type,
      question: document.getElementById("qf-text").value.trim(),
      category: document.getElementById("qf-category").value,
      difficulty: document.getElementById("qf-difficulty").value,
      age_min: Number(document.getElementById("qf-age-min").value),
      age_max: Number(document.getElementById("qf-age-max").value),
      points: Number(document.getElementById("qf-points").value),
      explanation: document.getElementById("qf-explain").value.trim(),
      // نُصفّر حقول الأنواع الأخرى دائمًا حتى لا تبقى بيانات قديمة عالقة
      // عند تغيير نوع سؤال موجود مسبقًا
      option1: null, option2: null, option3: null, option4: null,
      correct_answer: null, pairs: null, ordered_items: null,
    };

    if (!payload.question){
      showToast("يجب كتابة نص السؤال");
      return;
    }

    if (type === "multiple_choice"){
      const opts = [
        document.getElementById("qf-opt1").value.trim(),
        document.getElementById("qf-opt2").value.trim(),
        document.getElementById("qf-opt3").value.trim(),
        document.getElementById("qf-opt4").value.trim(),
      ];
      if (opts.some(o => !o)){
        showToast("يجب تعبئة الخيارات الأربعة جميعًا");
        return;
      }
      const normalized = opts.map(o => o.toLowerCase());
      if (new Set(normalized).size !== 4){
        showToast("لا يمكن أن تتكرر نفس الإجابة أكثر من مرة بين الخيارات الأربعة");
        return;
      }
      payload.option1 = opts[0]; payload.option2 = opts[1];
      payload.option3 = opts[2]; payload.option4 = opts[3];
      payload.correct_answer = Number(document.getElementById("qf-correct").value);
      if (![1,2,3,4].includes(payload.correct_answer)){
        showToast("يرجى تحديد رقم الإجابة الصحيحة (1-4)");
        return;
      }

    } else if (type === "true_false"){
      const checked = document.querySelector('input[name="qf-tf"]:checked');
      payload.correct_answer = checked ? Number(checked.value) : 1;

    } else if (type === "matching"){
      const rows = Array.from(document.querySelectorAll("#qf-pairs-list .pair-row"));
      const pairs = rows.map(row => ({
        left: row.querySelector(".qf-pair-left").value.trim(),
        right: row.querySelector(".qf-pair-right").value.trim(),
      })).filter(p => p.left || p.right);

      if (pairs.length < 2){
        showToast("يجب إضافة زوجين على الأقل للمطابقة");
        return;
      }
      if (pairs.some(p => !p.left || !p.right)){
        showToast("يجب تعبئة طرفي كل زوج مطابقة");
        return;
      }
      const rightValues = pairs.map(p => p.right.toLowerCase());
      if (new Set(rightValues).size !== rightValues.length){
        showToast("لا يمكن أن تتكرر نفس الإجابة الصحيحة في أكثر من زوج");
        return;
      }
      payload.pairs = pairs;

    } else if (type === "ordering"){
      const rows = Array.from(document.querySelectorAll("#qf-items-list .item-row"));
      const items = rows.map(row => row.querySelector(".qf-item-value").value.trim()).filter(Boolean);

      if (items.length < 2){
        showToast("يجب إضافة عنصرين على الأقل للترتيب");
        return;
      }
      const normalized = items.map(i => i.toLowerCase());
      if (new Set(normalized).size !== normalized.length){
        showToast("لا يمكن أن يتكرر نفس العنصر أكثر من مرة في قائمة الترتيب");
        return;
      }
      payload.ordered_items = items;
    }

    try{
      await QV.saveQuestion(payload);
      closeModal("modal-question");
      showToast("تم حفظ السؤال بنجاح ✔");
      await renderQuestionsTable();
    }catch(err){
      showToast("حدث خطأ أثناء الحفظ");
      console.error(err);
    }
  }

  async function onDeleteQuestion(id){
    if (!confirm("هل تريد حذف هذا السؤال؟")) return;
    await QV.deleteQuestion(id);
    showToast("تم حذف السؤال");
    await renderQuestionsTable();
  }

  /* ---------------- settings: questions per category + timer per category + quiz behavior toggles ---------------- */
  async function renderSettingsTable(){
    const [counts, quizSettings, timers] = await Promise.all([
      QV.getQuestionCounts(), QV.getQuizSettings(), QV.getCategoryTimers(),
    ]);

    document.getElementById("chk-shuffle-questions").checked = quizSettings.shuffleQuestions !== false;
    document.getElementById("chk-shuffle-answers").checked = quizSettings.shuffleAnswers !== false;
    document.getElementById("chk-prevent-repeat").checked = quizSettings.preventRepetition !== false;
    document.getElementById("chk-random-generation").checked = quizSettings.randomGeneration !== false;

    const tbody = document.getElementById("settings-tbody");
    tbody.innerHTML = QUIZ_CATEGORIES.map(c => `
      <tr>
        <td data-label="الفئة">${c.icon} ${c.name}</td>
        <td data-label="عدد الأسئلة"><input type="number" min="1" max="30" value="${counts[c.id] || QUIZVERSE_CONFIG.DEFAULT_QUESTIONS_PER_QUIZ}" data-count-cat="${c.id}" class="admin-input"></td>
        <td data-label="المؤقت (ثانية)"><input type="number" min="1" max="300" value="${timers[c.id] || QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION}" data-timer-cat="${c.id}" class="admin-input"></td>
      </tr>
    `).join("");
  }

  async function onSaveSettings(){
    const counts = {};
    document.querySelectorAll("[data-count-cat]").forEach(inp => {
      counts[inp.dataset.countCat] = Math.max(1, Number(inp.value) || QUIZVERSE_CONFIG.DEFAULT_QUESTIONS_PER_QUIZ);
    });

    // تحقّق من صحة المؤقت: يجب أن يكون 1 ثانية على الأقل، لا صفر ولا أرقام سالبة
    const timers = {};
    let hasInvalidTimer = false;
    document.querySelectorAll("[data-timer-cat]").forEach(inp => {
      const n = Number(inp.value);
      if (!Number.isFinite(n) || n < 1) hasInvalidTimer = true;
      timers[inp.dataset.timerCat] = Math.max(1, Math.floor(n) || QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION);
    });
    if (hasInvalidTimer){
      showToast("قيمة المؤقت يجب أن تكون ثانية واحدة على الأقل لكل فئة");
      return;
    }

    const quizSettings = {
      shuffleQuestions: document.getElementById("chk-shuffle-questions").checked,
      shuffleAnswers: document.getElementById("chk-shuffle-answers").checked,
      preventRepetition: document.getElementById("chk-prevent-repeat").checked,
      randomGeneration: document.getElementById("chk-random-generation").checked,
    };
    try{
      await Promise.all([
        QV.saveQuestionCounts(counts),
        QV.saveCategoryTimers(timers),
        QV.saveQuizSettings(quizSettings),
      ]);
      showToast("تم حفظ إعدادات الاختبار ✔");
      await renderSettingsTable();
    }catch(err){
      showToast("تعذّر حفظ الإعدادات");
      console.error(err);
    }
  }

  /* ---------------- مؤقت الأسئلة حسب العمر ---------------- */
  async function renderAgeTimersTable(){
    const settings = await QV.getAgeTimerSettings();
    const tbody = document.getElementById("age-timers-tbody");
    tbody.innerHTML = settings.length ? settings.map(s => `
      <tr>
        <td data-label="الفئة العمرية">${s.max_age >= 99 ? `${s.min_age}+` : `${s.min_age} - ${s.max_age}`}</td>
        <td data-label="الوقت (ثانية)">${s.time_seconds} ث</td>
        <td class="table-actions" data-label="">
          <button data-edit-timer="${s.id}">تعديل</button>
          <button data-del-timer="${s.id}" class="danger">حذف</button>
        </td>
      </tr>
    `).join("") : `<tr><td colspan="3" class="muted" style="text-align:center;padding:24px">لا توجد فئات عمرية بعد — أضف واحدة لتفعيل المؤقت التلقائي حسب العمر</td></tr>`;

    tbody.querySelectorAll("[data-edit-timer]").forEach(b => b.addEventListener("click", () => {
      const setting = settings.find(s => s.id === b.dataset.editTimer);
      openAgeTimerModal(setting);
    }));
    tbody.querySelectorAll("[data-del-timer]").forEach(b => b.addEventListener("click", () => onDeleteAgeTimer(b.dataset.delTimer)));
  }

  function openAgeTimerModal(s){
    document.getElementById("age-timer-modal-title").textContent = s ? "تعديل الفئة العمرية" : "فئة عمرية جديدة";
    document.getElementById("atf-id").value = s ? s.id : "";
    document.getElementById("atf-min-age").value = s ? s.min_age : 5;
    document.getElementById("atf-max-age").value = s ? s.max_age : 7;
    document.getElementById("atf-seconds").value = s ? s.time_seconds : QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION;
    document.getElementById("atf-err").textContent = "";
    openModal("modal-age-timer");
  }

  async function onSaveAgeTimer(e){
    e.preventDefault();
    const errEl = document.getElementById("atf-err");
    errEl.textContent = "";

    const setting = {
      id: document.getElementById("atf-id").value || undefined,
      min_age: Number(document.getElementById("atf-min-age").value),
      max_age: Number(document.getElementById("atf-max-age").value),
      time_seconds: Number(document.getElementById("atf-seconds").value),
    };

    if (setting.min_age > setting.max_age){
      errEl.textContent = "العمر الأدنى يجب أن يكون أقل من أو يساوي العمر الأقصى";
      return;
    }
    if (!Number.isFinite(setting.time_seconds) || setting.time_seconds < 1){
      errEl.textContent = "يجب أن يكون الوقت ثانية واحدة على الأقل";
      return;
    }

    try{
      await QV.saveAgeTimerSetting(setting);
      closeModal("modal-age-timer");
      showToast("تم حفظ الفئة العمرية بنجاح ✔");
      await renderAgeTimersTable();
    }catch(err){
      errEl.textContent = err.message || "تعذّر الحفظ";
    }
  }

  async function onDeleteAgeTimer(id){
    if (!confirm("هل تريد حذف هذه الفئة العمرية؟")) return;
    try{
      await QV.deleteAgeTimerSetting(id);
      showToast("تم الحذف");
      await renderAgeTimersTable();
    }catch(err){
      showToast("تعذّر الحذف");
      console.error(err);
    }
  }

  /* ---------------- players: replay grants ---------------- */
  async function renderPlayersTable(){
    const profiles = await QV.listAllProfiles();
    const tbody = document.getElementById("players-tbody");
    const diffLabel = { easy: "سهل", medium: "متوسط", hard: "صعب" };
    const catOptions = QUIZ_CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");

    tbody.innerHTML = profiles.length ? profiles.map(p => `
      <tr>
        <td data-label="اللاعب">${p.avatar || ""} ${escapeHtml(p.username)}</td>
        <td data-label="النقاط">${p.total_score || 0}</td>
        <td data-label="الاختبارات">${p.games_played || 0}</td>
        <td data-label="منح محاولة إضافية">
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <select data-grant-cat="${p.id}">${catOptions}</select>
            <select data-grant-diff="${p.id}">
              <option value="easy">سهل</option>
              <option value="medium" selected>متوسط</option>
              <option value="hard">صعب</option>
            </select>
            <button type="button" data-grant-btn="${p.id}">منح محاولة</button>
          </div>
        </td>
      </tr>
    `).join("") : `<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">لا يوجد لاعبون مسجّلون بعد</td></tr>`;

    tbody.querySelectorAll("[data-grant-btn]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.grantBtn;
        const cat = tbody.querySelector(`[data-grant-cat="${id}"]`).value;
        const diff = tbody.querySelector(`[data-grant-diff="${id}"]`).value;
        try{
          await QV.grantReplay(id, cat, diff);
          showToast(`تم منح محاولة إضافية: ${catName(cat)} / ${diffLabel[diff]} ✔`);
        }catch(err){
          showToast("تعذّر منح المحاولة");
          console.error(err);
        }
      });
    });
  }

  /* ---------------- games ---------------- */
  let editingGames = [];
  async function renderGamesTable(){
    editingGames = await QV.getGames();
    const tbody = document.getElementById("games-tbody");
    const statusLabel = { waiting: "بانتظار البدء", started: "جارية", finished: "منتهية" };
    tbody.innerHTML = editingGames.map(g => `
      <tr>
        <td data-label="العنوان">${escapeHtml(g.title)}</td>
        <td data-label="الفئة">${catIcon(g.category)} ${catName(g.category)}</td>
        <td data-label="اللاعبون">${g.max_players}</td>
        <td data-label="الحالة"><span class="mp-status ${g.status}">${statusLabel[g.status] || g.status}</span></td>
        <td class="table-actions" data-label="">
          ${g.status === "waiting" ? `<button data-start="${g.id}">بدء</button>` : ""}
          ${g.status === "started" ? `<button data-finish="${g.id}">إنهاء</button>` : ""}
          <button data-del="${g.id}" class="danger">حذف</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">لا توجد غرف بعد</td></tr>`;

    tbody.querySelectorAll("[data-start]").forEach(b => b.addEventListener("click", () => setGameStatus(b.dataset.start, "started")));
    tbody.querySelectorAll("[data-finish]").forEach(b => b.addEventListener("click", () => setGameStatus(b.dataset.finish, "finished")));
    tbody.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => onDeleteGame(b.dataset.del)));
  }

  async function onDeleteGame(id){
    if (!confirm("هل تريد حذف هذه الغرفة نهائيًا؟ سيتم إخراج كل اللاعبين المنضمين إليها.")) return;
    try{
      await QV.deleteGame(id);
      showToast("تم حذف الغرفة");
      await renderGamesTable();
    }catch(err){
      showToast("تعذّر حذف الغرفة");
      console.error(err);
    }
  }

  async function setGameStatus(id, status){
    const patch = { id, status };
    if (status === "started"){
      // نبني مجموعة أسئلة ثابتة مرة واحدة هنا، ليحصل كل اللاعبين على نفس الأسئلة
      // وبنفس الترتيب تمامًا (عدالة المنافسة) — بينما يبقى ترتيب الخيارات الأربعة
      // يُخلط بشكل مستقل في متصفح كل لاعب على حدة (لمنع الغش دون كسر العدالة).
      const game = editingGames.find(g => g.id === id);
      if (game){
        const questionSet = await QV.getQuestions({
          category: game.category,
          ageMin: game.min_age, ageMax: game.max_age,
          limit: game.question_count,
        });
        patch.question_set = questionSet;
      }
    }
    await QV.saveGame(patch);
    showToast(status === "started" ? "بدأت اللعبة! سيتم إشعار جميع اللاعبين لحظيًا 🚀" : "تم إنهاء الغرفة");
    await renderGamesTable();
  }

  function openGameModal(){
    document.getElementById("form-game").reset();
    document.getElementById("gf-qcount").value = 10;
    document.getElementById("gf-time").value = 15;
    document.getElementById("gf-maxplayers").value = 20;
    document.getElementById("gf-age-min").value = 5;
    document.getElementById("gf-age-max").value = 99;
    applyGameTimerModeUI("custom");
    openModal("modal-game");
  }

  function applyGameTimerModeUI(mode){
    document.getElementById("gf-time-group").hidden = mode === "age_based";
  }

  async function onSaveGame(e){
    e.preventDefault();
    const timerMode = document.querySelector('input[name="gf-timer-mode"]:checked').value;
    const payload = {
      timer_mode: timerMode,
      time_per_question: timerMode === "age_based" ? 15 : Number(document.getElementById("gf-time").value),
      title: document.getElementById("gf-title").value.trim(),
      description: document.getElementById("gf-desc").value.trim(),
      category: document.getElementById("gf-category").value,
      question_count: Number(document.getElementById("gf-qcount").value),
      max_players: Number(document.getElementById("gf-maxplayers").value),
      min_age: Number(document.getElementById("gf-age-min").value),
      max_age: Number(document.getElementById("gf-age-max").value),
      status: "waiting",
      start_time: new Date().toISOString(),
    };
    try{
      await QV.saveGame(payload);
      closeModal("modal-game");
      showToast("تم إنشاء الغرفة بنجاح ✔");
      await renderGamesTable();
    }catch(err){
      showToast("حدث خطأ أثناء إنشاء الغرفة");
      console.error(err);
    }
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  return { init, get loggedIn(){ return loggedIn; } };
})();
