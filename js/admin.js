/* =========================================================
   لوحة تحكم المشرف: تسجيل الدخول، إدارة الأسئلة، إدارة
   الغرف الجماعية، وعرض الإحصائيات.
   ========================================================= */

const Admin = (function(){
  let loggedIn = false;
  let currentAdminUsername = null;
  // currentRole: "admin" (المشرف الرئيسي، كل الصلاحيات) أو "subadmin" (صلاحيات محدودة:
  // إدارة الغرف الجماعية والأسئلة الخاصة بغرفه فقط — راجع "نظام المشرفين الفرعيين")
  let currentRole = "admin";
  let currentSubAdminId = null;
  let selectedLoginRole = "admin";

  // اللوحات المتاحة للمشرف الرئيسي فقط — يُمنع المشرف الفرعي من الوصول إليها
  // حتى لو حاول تفعيلها يدويًا (حماية إضافية من جهة الواجهة، إلى جانب إخفاء
  // أزرارها بالكامل من القائمة الجانبية)
  const ADMIN_ONLY_PANELS = new Set(["panel-stats", "panel-settings", "panel-age-timers", "panel-players", "panel-subadmins", "panel-activity"]);

  function init(){
    document.getElementById("form-admin-login").addEventListener("submit", onLogin);
    document.getElementById("btn-admin-logout").addEventListener("click", logout);

    document.querySelectorAll("#admin-role-tabs .role-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("#admin-role-tabs .role-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        selectedLoginRole = tab.dataset.role;
        const isSub = selectedLoginRole === "subadmin";
        document.getElementById("admin-login-eyebrow").textContent = isSub ? "دخول مشرف فرعي" : "دخول المشرف";
        document.getElementById("admin-login-title").textContent = isSub ? "لوحة المشرف الفرعي" : "لوحة التحكم";
      });
    });

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

    document.getElementById("btn-new-subadmin").addEventListener("click", () => openSubAdminModal());
    document.getElementById("form-subadmin").addEventListener("submit", onSaveSubAdmin);
    document.getElementById("btn-cancel-subadmin").addEventListener("click", () => closeModal("modal-subadmin"));
    document.getElementById("btn-close-room-players").addEventListener("click", () => closeModal("modal-room-players"));

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
      if (selectedLoginRole === "subadmin"){
        const result = await QV.subAdminLogin(username, pass);
        loggedIn = true;
        currentRole = "subadmin";
        currentAdminUsername = result.username;
        currentSubAdminId = result.id;
        applyRoleVisibility();
        goTo("screen-admin");
        switchPanel("panel-questions");
        await Promise.all([renderQuestionsTable(), renderGamesTable(), renderSuggestionsBadge()]);
        await QV.logActivity({ actorUsername: currentAdminUsername, actorRole: "subadmin", action: "تسجيل دخول" });
      } else {
        const result = await QV.adminLogin(username, pass);
        loggedIn = true;
        currentRole = "admin";
        currentAdminUsername = username;
        currentSubAdminId = null;
        applyRoleVisibility();
        if (result && result.bootstrapped){
          showToast("تم إنشاء حساب المشرف الأول بنجاح ✔ احفظ بيانات الدخول جيدًا");
        } else if (QV.isDemoMode){
          showToast("تم الدخول في الوضع التجريبي المحلي ✦");
        }
        goTo("screen-admin");
        switchPanel("panel-stats");
        await Promise.all([renderStats(), renderQuestionsTable(), renderGamesTable(), renderSettingsTable(), renderPlayersTable(), renderAgeTimersTable(), renderSubAdminsTable(), renderActivityLogTable(), renderSuggestionsBadge()]);
      }
    }catch(err){
      errEl.textContent = err.message || "بيانات الدخول غير صحيحة، أو الحساب لا يملك صلاحية الدخول.";
    }
  }

  function logout(){
    if (currentRole === "subadmin" && currentAdminUsername){
      QV.logActivity({ actorUsername: currentAdminUsername, actorRole: "subadmin", action: "تسجيل خروج" });
    }
    loggedIn = false;
    currentAdminUsername = null;
    currentRole = "admin";
    currentSubAdminId = null;
    document.querySelectorAll('[data-role="admin"]').forEach(el => { el.hidden = false; });
    const badge = document.getElementById("admin-role-badge");
    if (badge) badge.hidden = true;
    goTo("screen-welcome");
  }

  /* ---------------- إظهار/إخفاء عناصر الواجهة حسب الدور (مشرف رئيسي / مشرف فرعي) ---------------- */
  function applyRoleVisibility(){
    const isSub = currentRole === "subadmin";
    document.querySelectorAll('[data-role="admin"]').forEach(el => { el.hidden = isSub; });
    const badge = document.getElementById("admin-role-badge");
    if (badge){
      badge.hidden = !isSub;
      badge.textContent = isSub ? `🧩 مشرف فرعي: ${currentAdminUsername}` : "";
    }
    // زر إنشاء سؤال جديد أو غرفة جديدة يبقى ظاهرًا لكليهما — فقط النطاق يختلف
    document.getElementById("btn-new-question").hidden = false;
    document.getElementById("btn-new-game").hidden = false;
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
    // حماية إضافية من جهة الواجهة: لا يمكن لمشرف فرعي فتح لوحة مخصصة للمشرف
    // الرئيسي فقط، حتى لو حاول استدعاء التبديل مباشرة
    if (currentRole === "subadmin" && ADMIN_ONLY_PANELS.has(id)) id = "panel-questions";
    document.querySelectorAll(".admin-nav-btn[data-panel]").forEach(b => b.classList.toggle("active", b.dataset.panel === id));
    document.querySelectorAll(".admin-panel").forEach(p => p.classList.toggle("active", p.id === id));
    if (id === "panel-subadmins") renderSubAdminsTable();
    if (id === "panel-activity") renderActivityLogTable();
    if (id === "panel-suggestions") renderSuggestionsTable();
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
    const all = await QV.getQuestions({});
    // المشرف الفرعي يرى فقط الأسئلة التي أنشأها هو (سواء عامة له أو مرتبطة بإحدى غرفه)؛
    // المشرف الرئيسي يستمر برؤية كل الأسئلة كما هي العادة تمامًا دون أي تغيير
    editingQuestions = currentRole === "subadmin" ? all.filter(q => q.owner_username === currentAdminUsername) : all;

    const myGames = await visibleGames();
    const roomTitle = (roomId) => {
      if (!roomId) return "🌐 عام";
      const g = myGames.find(x => x.id === roomId);
      return g ? escapeHtml(g.title) : "غرفة محذوفة";
    };

    const tbody = document.getElementById("questions-tbody");
    tbody.innerHTML = editingQuestions.map(q => `
      <tr>
        <td class="q-cell" data-label="السؤال">${escapeHtml(q.question)}</td>
        <td data-label="النوع">${TYPE_LABELS[q.type] || TYPE_LABELS.multiple_choice}</td>
        <td data-label="الفئة">${catIcon(q.category)} ${catName(q.category)}</td>
        <td data-label="الغرفة">${roomTitle(q.room_id)}</td>
        <td data-label="العمر">${q.age_min}-${q.age_max}</td>
        <td data-label="الصعوبة">${{easy:"سهل",medium:"متوسط",hard:"صعب"}[q.difficulty] || q.difficulty}</td>
        <td data-label="النقاط">${q.points}</td>
        <td class="table-actions" data-label="">
          <button data-edit="${q.id}">تعديل</button>
          <button data-del="${q.id}" class="danger">حذف</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">لا توجد أسئلة بعد</td></tr>`;

    tbody.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openQuestionModal(editingQuestions.find(q => q.id === b.dataset.edit))));
    tbody.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => onDeleteQuestion(b.dataset.del)));
  }

  /* الغرف المرئية للدور الحالي: كل الغرف للمشرف الرئيسي، وغرف المشرف الفرعي فقط له */
  async function visibleGames(){
    return currentRole === "subadmin" ? QV.getGamesForOwner(currentAdminUsername) : QV.getGames();
  }

  async function populateRoomSelect(selectedRoomId){
    const games = await visibleGames();
    const sel = document.getElementById("qf-room");
    sel.innerHTML = `<option value="">🌐 عام (كل الغرف والاختبارات الفردية)</option>` +
      games.map(g => `<option value="${g.id}">${escapeHtml(g.title)}</option>`).join("");
    sel.value = selectedRoomId || "";
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
    populateRoomSelect(q ? q.room_id : "");
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
      // الغرفة المرتبطة بهذا السؤال (اختياري) — تُترك فارغة ليبقى السؤال ضمن
      // بنك الفئة العام كما كان دائمًا؛ ownership تُسجَّل فقط لأسئلة المشرفين
      // الفرعيين حتى يرى كل مشرف فرعي أسئلته هو فقط
      room_id: document.getElementById("qf-room").value || null,
      owner_username: currentRole === "subadmin" ? currentAdminUsername : null,
      // أي سؤال يُحفظ من لوحة تحكم المشرف (سواء جديد، أو تعديل مباشر، أو
      // "تعديل ثم قبول" لاقتراح لاعب) يصبح "مقبولاً" فورًا — فقط الاقتراحات
      // التي لم يفتحها أي مشرف بعد تبقى بحالة "قيد المراجعة"
      status: "approved",
      // نُصفّر حقول الأنواع الأخرى دائمًا حتى لا تبقى بيانات قديمة عالقة
      // عند تغيير نوع سؤال موجود مسبقًا
      option1: null, option2: null, option3: null, option4: null,
      correct_answer: null, pairs: null, ordered_items: null,
    };

    if (!payload.question){
      showToast("يجب كتابة نص السؤال");
      return;
    }

    // عند تعديل المشرف الرئيسي لسؤال أنشأه مشرف فرعي، نحافظ على ownership الأصلي
    // بدل مسحه، حتى يستمر ذلك المشرف الفرعي برؤية سؤاله في لوحته كما هو متوقع
    if (currentRole === "admin" && id){
      const original = editingQuestions.find(q => q.id === id);
      if (original && original.owner_username) payload.owner_username = original.owner_username;
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
      const isNew = !id;
      await QV.saveQuestion(payload);
      closeModal("modal-question");
      showToast("تم حفظ السؤال بنجاح ✔");
      await renderQuestionsTable();
      if (currentRole === "subadmin"){
        const games = await visibleGames();
        const room = games.find(g => g.id === payload.room_id);
        await QV.logActivity({
          actorUsername: currentAdminUsername, actorRole: "subadmin",
          action: isNew ? "إضافة سؤال" : "تعديل سؤال",
          roomName: room ? room.title : null,
          questionInfo: payload.question.slice(0, 80),
        });
      }
    }catch(err){
      showToast("حدث خطأ أثناء الحفظ");
      console.error(err);
    }
  }

  async function onDeleteQuestion(id){
    if (!confirm("هل تريد حذف هذا السؤال؟")) return;
    const target = editingQuestions.find(q => q.id === id);
    await QV.deleteQuestion(id);
    showToast("تم حذف السؤال");
    await renderQuestionsTable();
    if (currentRole === "subadmin" && target){
      const games = await visibleGames();
      const room = games.find(g => g.id === target.room_id);
      await QV.logActivity({
        actorUsername: currentAdminUsername, actorRole: "subadmin",
        action: "حذف سؤال",
        roomName: room ? room.title : null,
        questionInfo: (target.question || "").slice(0, 80),
      });
    }
  }

  /* ---------------- settings: questions per category + timer per category + quiz behavior toggles ---------------- */
  const QUESTION_TYPE_LABELS = {
    multiple_choice: "اختيار من متعدد",
    true_false: "صح / خطأ",
    matching: "مطابقة (توصيل)",
    ordering: "ترتيب",
  };
  const QUESTION_TYPE_ORDER = ["multiple_choice", "true_false", "matching", "ordering"];

  async function renderSettingsTable(){
    const [counts, quizSettings, timers, typeTimers] = await Promise.all([
      QV.getQuestionCounts(), QV.getQuizSettings(), QV.getCategoryTimers(), QV.getQuestionTypeTimers(),
    ]);

    document.getElementById("chk-shuffle-questions").checked = quizSettings.shuffleQuestions !== false;
    document.getElementById("chk-shuffle-answers").checked = quizSettings.shuffleAnswers !== false;
    document.getElementById("chk-prevent-repeat").checked = quizSettings.preventRepetition !== false;
    document.getElementById("chk-random-generation").checked = quizSettings.randomGeneration !== false;

    const typeTbody = document.getElementById("type-timers-tbody");
    typeTbody.innerHTML = QUESTION_TYPE_ORDER.map(t => `
      <tr>
        <td data-label="نوع السؤال">${QUESTION_TYPE_LABELS[t]}</td>
        <td data-label="الوقت (ثانية)"><input type="number" min="1" max="300" value="${typeTimers[t] || QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION}" data-timer-type="${t}" class="admin-input"></td>
      </tr>
    `).join("");

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

    const typeTimers = {};
    document.querySelectorAll("[data-timer-type]").forEach(inp => {
      const n = Number(inp.value);
      if (!Number.isFinite(n) || n < 1) hasInvalidTimer = true;
      typeTimers[inp.dataset.timerType] = Math.max(1, Math.floor(n) || QUIZVERSE_CONFIG.DEFAULT_TIME_PER_QUESTION);
    });

    if (hasInvalidTimer){
      showToast("قيمة المؤقت يجب أن تكون ثانية واحدة على الأقل");
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
        QV.saveQuestionTypeTimers(typeTimers),
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

    tbody.innerHTML = profiles.length ? profiles.map(p => {
      const answered = p.total_questions_answered || 0;
      const correct = p.correct_answers || 0;
      const wrong = p.wrong_answers || 0;
      const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
      const correctPct = answered > 0 ? Math.round((correct / answered) * 100) : 0;
      const wrongPct = answered > 0 ? Math.round((wrong / answered) * 100) : 0;
      return `
      <tr>
        <td data-label="اللاعب">${p.avatar || ""} ${escapeHtml(p.username)}</td>
        <td data-label="الأسئلة المحلولة">${answered}</td>
        <td data-label="إجابات صحيحة">${correct}</td>
        <td data-label="إجابات خاطئة">${wrong}</td>
        <td data-label="الأداء">
          <div class="perf-bars">
            <div class="perf-bar-row">
              <div class="perf-bar-track"><div class="perf-bar-fill correct" style="width:${correctPct}%"></div></div>
              <span class="perf-bar-label">${correctPct}%</span>
            </div>
            <div class="perf-bar-row">
              <div class="perf-bar-track"><div class="perf-bar-fill wrong" style="width:${wrongPct}%"></div></div>
              <span class="perf-bar-label">${wrongPct}%</span>
            </div>
          </div>
        </td>
        <td data-label="نسبة الصحة">${accuracy}%</td>
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
    `;
    }).join("") : `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">لا يوجد لاعبون مسجّلون بعد</td></tr>`;

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
    editingGames = await visibleGames();
    // عدد اللاعبين المنضمين فعليًا الآن لكل غرفة (وليس الحد الأقصى المسموح فقط)
    const counts = await Promise.all(editingGames.map(g => QV.getGamePlayers(g.id)));
    editingGames.forEach((g, i) => { g._playerCount = counts[i].length; });

    const tbody = document.getElementById("games-tbody");
    const statusLabel = { waiting: "بانتظار البدء", started: "جارية", finished: "منتهية" };
    tbody.innerHTML = editingGames.map(g => `
      <tr>
        <td data-label="العنوان">${escapeHtml(g.title)}</td>
        <td data-label="الفئة">${catIcon(g.category)} ${catName(g.category)}</td>
        <td data-label="المالك">${g.owner_username ? "🧩 " + escapeHtml(g.owner_username) : "🛡️ المشرف الرئيسي"}</td>
        <td data-label="اللاعبون">👥 ${g._playerCount} / ${g.max_players}</td>
        <td data-label="الحالة"><span class="mp-status ${g.status}">${statusLabel[g.status] || g.status}</span></td>
        <td class="table-actions" data-label="">
          ${g.status === "waiting" ? `<button data-start="${g.id}">بدء</button>` : ""}
          ${g.status === "started" ? `<button data-finish="${g.id}">إنهاء</button>` : ""}
          <button data-view-players="${g.id}">👥 اللاعبون</button>
          <button data-allow-rejoin="${g.id}" data-room-title="${escapeHtml(g.title)}">🔓 سماح بالانضمام</button>
          <button data-del="${g.id}" class="danger">حذف</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">لا توجد غرف بعد</td></tr>`;

    tbody.querySelectorAll("[data-start]").forEach(b => b.addEventListener("click", () => setGameStatus(b.dataset.start, "started")));
    tbody.querySelectorAll("[data-finish]").forEach(b => b.addEventListener("click", () => setGameStatus(b.dataset.finish, "finished")));
    tbody.querySelectorAll("[data-view-players]").forEach(b => b.addEventListener("click", () => openRoomPlayersModal(b.dataset.viewPlayers)));
    tbody.querySelectorAll("[data-allow-rejoin]").forEach(b => b.addEventListener("click", () => onGrantRoomRejoin(b.dataset.allowRejoin, b.dataset.roomTitle)));
    tbody.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => onDeleteGame(b.dataset.del)));
  }

  async function onGrantRoomRejoin(gameId, roomTitle){
    const username = prompt(`اسم مستخدم اللاعب الذي تريد السماح له بالانضمام مرة أخرى لغرفة "${roomTitle}":`);
    if (!username || !username.trim()) return;
    try{
      await QV.grantRoomRejoinByUsername(username.trim(), gameId);
      showToast(`تم السماح لـ ${username.trim()} بالانضمام مرة أخرى لهذه الغرفة ✔`);
    }catch(err){
      showToast(err.message || "تعذّر منح الإذن");
    }
  }

  async function onDeleteGame(id){
    if (!confirm("هل تريد حذف هذه الغرفة نهائيًا؟ سيتم إخراج كل اللاعبين المنضمين إليها.")) return;
    const target = editingGames.find(g => g.id === id);
    try{
      await QV.deleteGame(id);
      showToast("تم حذف الغرفة");
      await renderGamesTable();
      if (currentRole === "subadmin" && target){
        await QV.logActivity({ actorUsername: currentAdminUsername, actorRole: "subadmin", action: "حذف غرفة", roomName: target.title });
      }
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
        const rs = game.quiz_random_settings || {};
        const useAgeFilter = rs.ageFilterEnabled !== false;
        const buildOpts = {
          ageMin: useAgeFilter ? game.min_age : null,
          ageMax: useAgeFilter ? game.max_age : null,
          limit: game.question_count,
          allowedTypes: rs.allowedTypes && rs.allowedTypes.length ? rs.allowedTypes : null,
          difficultyDistribution: rs.difficultyDistribution || null,
          settingsOverride: {
            shuffleQuestions: rs.shuffleQuestions !== false,
            preventRepetition: false, // مجموعة الغرفة موحّدة لكل اللاعبين، لا داعٍ لاستبعاد أسئلة أي لاعب بعينه
          },
        };
        // أولوية لأسئلة هذه الغرفة تحديدًا إن أضافها المشرف الفرعي؛ وإلا رجوع
        // تلقائي لبنك أسئلة الفئة المعرفية العام (السلوك الأصلي دون أي تغيير)
        let questionSet = await QV.getQuestions({ ...buildOpts, roomId: game.id });
        if (!questionSet.length){
          questionSet = await QV.getQuestions({ ...buildOpts, category: game.category });
        }
        patch.question_set = questionSet;
      }
    }
    await QV.saveGame(patch);
    showToast(status === "started" ? "بدأت اللعبة! سيتم إشعار جميع اللاعبين لحظيًا 🚀" : "تم إنهاء الغرفة");
    await renderGamesTable();
    if (currentRole === "subadmin"){
      const g = editingGames.find(x => x.id === id);
      await QV.logActivity({
        actorUsername: currentAdminUsername, actorRole: "subadmin",
        action: status === "started" ? "بدء غرفة" : "إنهاء غرفة",
        roomName: g ? g.title : null,
      });
    }
  }

  function openGameModal(){
    document.getElementById("form-game").reset();
    document.getElementById("gf-qcount").value = 10;
    document.getElementById("gf-time").value = 15;
    document.getElementById("gf-maxplayers").value = 20;
    document.getElementById("gf-age-min").value = 5;
    document.getElementById("gf-age-max").value = 99;
    document.getElementById("gf-shuffle-questions").checked = true;
    document.getElementById("gf-shuffle-answers").checked = true;
    document.getElementById("gf-age-filter").checked = true;
    document.querySelectorAll("#gf-allowed-types input[type=checkbox]").forEach(c => c.checked = true);
    document.getElementById("gf-dist-easy").value = 0;
    document.getElementById("gf-dist-medium").value = 0;
    document.getElementById("gf-dist-hard").value = 0;
    document.getElementById("gf-dist-err").textContent = "";
    applyGameTimerModeUI("custom");
    openModal("modal-game");
  }

  function applyGameTimerModeUI(mode){
    document.getElementById("gf-time-group").hidden = mode === "age_based";
  }

  async function onSaveGame(e){
    e.preventDefault();
    const timerMode = document.querySelector('input[name="gf-timer-mode"]:checked').value;

    const distEasy = Number(document.getElementById("gf-dist-easy").value) || 0;
    const distMedium = Number(document.getElementById("gf-dist-medium").value) || 0;
    const distHard = Number(document.getElementById("gf-dist-hard").value) || 0;
    const distErrEl = document.getElementById("gf-dist-err");
    distErrEl.textContent = "";
    if (distEasy + distMedium + distHard > 100){
      distErrEl.textContent = "مجموع نسب الصعوبة يجب ألا يتجاوز 100%";
      return;
    }

    const allowedTypes = Array.from(document.querySelectorAll("#gf-allowed-types input[type=checkbox]:checked")).map(c => c.value);
    if (!allowedTypes.length){
      distErrEl.textContent = "يجب اختيار نوع سؤال واحد على الأقل";
      return;
    }

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
      // الغرفة تنتمي للمشرف الفرعي الذي أنشأها (إن وُجد)، ما يحصر إدارتها لاحقًا
      // على صاحبها فقط — تبقى غرف المشرف الرئيسي بلا مالك كما كانت دائمًا
      owner_username: currentRole === "subadmin" ? currentAdminUsername : null,
      // إعدادات العشوائية الخاصة بهذه الغرفة تحديدًا (ميزة #8)
      quiz_random_settings: {
        shuffleQuestions: document.getElementById("gf-shuffle-questions").checked,
        shuffleAnswers: document.getElementById("gf-shuffle-answers").checked,
        ageFilterEnabled: document.getElementById("gf-age-filter").checked,
        allowedTypes,
        difficultyDistribution: (distEasy + distMedium + distHard) > 0
          ? { easy: distEasy, medium: distMedium, hard: distHard }
          : null,
      },
    };
    try{
      await QV.saveGame(payload);
      closeModal("modal-game");
      showToast("تم إنشاء الغرفة بنجاح ✔");
      await renderGamesTable();
      if (currentRole === "subadmin"){
        await QV.logActivity({ actorUsername: currentAdminUsername, actorRole: "subadmin", action: "إنشاء غرفة", roomName: payload.title });
      }
    }catch(err){
      showToast("حدث خطأ أثناء إنشاء الغرفة");
      console.error(err);
    }
  }

  /* ---------------- sub admins (main admin only) ---------------- */
  async function renderSubAdminsTable(){
    if (currentRole !== "admin") return;
    const subs = await QV.listSubAdmins();
    const tbody = document.getElementById("subadmins-tbody");
    tbody.innerHTML = subs.length ? subs.map(s => `
      <tr>
        <td data-label="اسم المستخدم">🧩 ${escapeHtml(s.username)}</td>
        <td data-label="الحالة"><span class="mp-status ${s.active ? "started" : "finished"}">${s.active ? "مفعّل" : "موقوف"}</span></td>
        <td data-label="تاريخ الإنشاء">${formatLogDate(s.created_at)}</td>
        <td class="table-actions" data-label="">
          <button data-edit-sub="${s.id}">تعديل</button>
          <button data-toggle-sub="${s.id}" data-active="${s.active ? "1" : "0"}">${s.active ? "إيقاف" : "تفعيل"}</button>
          <button data-del-sub="${s.id}" class="danger">حذف</button>
        </td>
      </tr>
    `).join("") : `<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">لا يوجد مشرفون فرعيون بعد</td></tr>`;

    tbody.querySelectorAll("[data-edit-sub]").forEach(b => b.addEventListener("click", () => {
      const s = subs.find(x => x.id === b.dataset.editSub);
      openSubAdminModal(s);
    }));
    tbody.querySelectorAll("[data-toggle-sub]").forEach(b => b.addEventListener("click", async () => {
      try{
        await QV.setSubAdminActive(b.dataset.toggleSub, b.dataset.active !== "1");
        showToast("تم تحديث حالة الحساب ✔");
        await renderSubAdminsTable();
      }catch(err){ showToast(err.message || "تعذّر تحديث الحالة"); }
    }));
    tbody.querySelectorAll("[data-del-sub]").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("هل تريد حذف هذا الحساب نهائيًا؟")) return;
      try{
        await QV.deleteSubAdmin(b.dataset.delSub);
        showToast("تم حذف الحساب");
        await renderSubAdminsTable();
      }catch(err){ showToast(err.message || "تعذّر الحذف"); }
    }));
  }

  function openSubAdminModal(s){
    document.getElementById("subadmin-modal-title").textContent = s ? "تعديل مشرف فرعي" : "مشرف فرعي جديد";
    document.getElementById("saf-id").value = s ? s.id : "";
    document.getElementById("saf-username").value = s ? s.username : "";
    document.getElementById("saf-password").value = "";
    document.getElementById("saf-password").required = !s;
    document.getElementById("saf-pass-label").textContent = s ? "كلمة مرور جديدة (اتركها فارغة للإبقاء عليها كما هي)" : "كلمة المرور";
    document.getElementById("saf-err").textContent = "";
    openModal("modal-subadmin");
  }

  async function onSaveSubAdmin(e){
    e.preventDefault();
    const errEl = document.getElementById("saf-err");
    errEl.textContent = "";
    const id = document.getElementById("saf-id").value || null;
    const username = document.getElementById("saf-username").value.trim();
    const password = document.getElementById("saf-password").value;

    try{
      if (id){
        const patch = { username };
        if (password) patch.password = password;
        await QV.updateSubAdmin(id, patch);
        showToast("تم تحديث بيانات المشرف الفرعي ✔");
      } else {
        await QV.createSubAdmin({ username, password });
        showToast("تم إنشاء حساب المشرف الفرعي بنجاح ✔");
      }
      closeModal("modal-subadmin");
      await renderSubAdminsTable();
    }catch(err){
      errEl.textContent = err.message || "تعذّر الحفظ";
    }
  }

  /* ---------------- activity log (main admin only) ---------------- */
  function formatLogDate(iso){
    try{
      const d = new Date(iso);
      return d.toLocaleString("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }catch(e){ return iso || ""; }
  }

  async function renderActivityLogTable(){
    if (currentRole !== "admin") return;
    const log = await QV.getActivityLog();
    const tbody = document.getElementById("activity-tbody");
    tbody.innerHTML = log.length ? log.map(l => `
      <tr>
        <td data-label="المشرف">🧩 ${escapeHtml(l.actor_username)}</td>
        <td data-label="العملية">${escapeHtml(l.action)}</td>
        <td data-label="الغرفة">${l.room_name ? escapeHtml(l.room_name) : "—"}</td>
        <td data-label="السؤال">${l.question_info ? escapeHtml(l.question_info) : "—"}</td>
        <td data-label="التاريخ والوقت">${formatLogDate(l.created_at)}</td>
      </tr>
    `).join("") : `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">لا يوجد أي نشاط مسجّل بعد</td></tr>`;
  }

  /* ---------------- player-submitted question suggestions (both roles) ---------------- */
  async function renderSuggestionsBadge(){
    const list = await QV.getQuestionSuggestions();
    const badge = document.getElementById("suggestions-badge");
    if (!badge) return;
    badge.hidden = list.length === 0;
    badge.textContent = String(list.length);
  }

  async function renderSuggestionsTable(){
    const list = await QV.getQuestionSuggestions();
    await renderSuggestionsBadge();
    const tbody = document.getElementById("suggestions-tbody");
    const diffLabel = { easy: "سهل", medium: "متوسط", hard: "صعب" };
    tbody.innerHTML = list.length ? list.map(q => `
      <tr>
        <td data-label="المرسل">👤 ${escapeHtml(q.suggested_by || "لاعب")}</td>
        <td class="q-cell" data-label="السؤال">${escapeHtml(q.question)}</td>
        <td data-label="النوع">${TYPE_LABELS[q.type] || TYPE_LABELS.multiple_choice}</td>
        <td data-label="الفئة">${catIcon(q.category)} ${catName(q.category)}</td>
        <td data-label="المستوى">${diffLabel[q.difficulty] || q.difficulty}</td>
        <td class="table-actions" data-label="">
          <button data-approve-sg="${q.id}">✅ قبول</button>
          <button data-edit-sg="${q.id}">✏️ تعديل ثم قبول</button>
          <button data-reject-sg="${q.id}" class="danger">❌ رفض</button>
        </td>
      </tr>
    `).join("") : `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">لا توجد اقتراحات جديدة حاليًا</td></tr>`;

    tbody.querySelectorAll("[data-approve-sg]").forEach(b => b.addEventListener("click", () => onApproveSuggestion(b.dataset.approveSg, list)));
    tbody.querySelectorAll("[data-edit-sg]").forEach(b => b.addEventListener("click", () => {
      const q = list.find(x => x.id === b.dataset.editSg);
      if (q) openQuestionModal(q); // نفس نموذج تعديل الأسئلة تمامًا — الحفظ يقبل الاقتراح تلقائيًا (status: "approved")
    }));
    tbody.querySelectorAll("[data-reject-sg]").forEach(b => b.addEventListener("click", () => onRejectSuggestion(b.dataset.rejectSg, list)));
  }

  async function onApproveSuggestion(id, list){
    try{
      await QV.approveQuestionSuggestion(id);
      showToast("تم قبول السؤال وإضافته لبنك الأسئلة ✔");
      await renderSuggestionsTable();
      await renderQuestionsTable();
      if (currentRole === "subadmin"){
        const q = list.find(x => x.id === id);
        await QV.logActivity({ actorUsername: currentAdminUsername, actorRole: "subadmin", action: "قبول اقتراح سؤال", questionInfo: q ? q.question.slice(0, 80) : null });
      }
    }catch(err){
      showToast("تعذّر قبول الاقتراح");
      console.error(err);
    }
  }

  async function onRejectSuggestion(id, list){
    if (!confirm("هل تريد رفض هذا الاقتراح نهائيًا؟ لن يمكن التراجع عن ذلك.")) return;
    try{
      const q = list.find(x => x.id === id);
      await QV.deleteQuestion(id);
      showToast("تم رفض الاقتراح");
      await renderSuggestionsTable();
      if (currentRole === "subadmin"){
        await QV.logActivity({ actorUsername: currentAdminUsername, actorRole: "subadmin", action: "رفض اقتراح سؤال", questionInfo: q ? q.question.slice(0, 80) : null });
      }
    }catch(err){
      showToast("تعذّر رفض الاقتراح");
      console.error(err);
    }
  }

  /* ---------------- room players: view + remove (both roles, scoped to visible rooms) ---------------- */
  let currentPlayersGameId = null;

  async function openRoomPlayersModal(gameId){
    currentPlayersGameId = gameId;
    const game = editingGames.find(g => g.id === gameId);
    document.getElementById("room-players-modal-title").textContent = game ? `👥 لاعبو غرفة "${game.title}"` : "لاعبو الغرفة";
    await renderRoomPlayersTable(gameId);
    openModal("modal-room-players");
  }

  async function renderRoomPlayersTable(gameId){
    const players = await QV.getGamePlayers(gameId);
    document.getElementById("room-players-count").textContent = players.length;
    const tbody = document.getElementById("room-players-tbody");
    tbody.innerHTML = players.length ? players.map(p => `
      <tr>
        <td data-label="اللاعب">${p.avatar || "🙂"} ${escapeHtml(p.name || "لاعب")}</td>
        <td data-label="العمر">${p.age || "—"}</td>
        <td data-label="النقاط">${p.score || 0}</td>
        <td data-label="الحالة">${p.finished_at ? "أنهى الاختبار ✔" : "لا يزال يلعب…"}</td>
        <td class="table-actions" data-label=""><button data-remove-player="${p.user_id}" class="danger">❌ إزالة</button></td>
      </tr>
    `).join("") : `<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">لا يوجد لاعبون في هذه الغرفة بعد</td></tr>`;

    tbody.querySelectorAll("[data-remove-player]").forEach(b => b.addEventListener("click", () => onRemoveRoomPlayer(gameId, b.dataset.removePlayer)));
  }

  async function onRemoveRoomPlayer(gameId, userId){
    if (!confirm("هل تريد إزالة هذا اللاعب من الغرفة؟ سيتمكن من الانضمام مجددًا لاحقًا إن سُمح له.")) return;
    try{
      await QV.removeGamePlayer(gameId, userId);
      showToast("تم إزالة اللاعب من الغرفة");
      await renderRoomPlayersTable(gameId);
      await renderGamesTable();
      if (currentRole === "subadmin"){
        const g = editingGames.find(x => x.id === gameId);
        await QV.logActivity({ actorUsername: currentAdminUsername, actorRole: "subadmin", action: "إزالة لاعب من غرفة", roomName: g ? g.title : null });
      }
    }catch(err){
      showToast("تعذّر إزالة اللاعب");
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
