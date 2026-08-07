/* =========================================================
   وحدة التحكم الرئيسية: تسجيل الدخول/إنشاء الحساب، لوحة اللاعب،
   الملف الشخصي، اختيار الفئة، الوضع الليلي/النهاري، والتأثيرات.
   ========================================================= */

let AppState = {
  profile: null,          // الملف الشخصي للاعب المسجّل دخوله حاليًا
  selectedCategory: null,
  selectedDifficulty: "medium",
  selectedMode: "solo",
};

/* ---------------- navigation ---------------- */
function goTo(screenId){
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
  // لوحة تحكم المشرف تعرض واجهتها الخاصة بالكامل دون شريط علوي للاعبين
  // (بلا أيقونة الرئيسية ولا أيقونة الإنجازات) حفاظًا على واجهة نظيفة ومركّزة
  const topbar = document.querySelector(".topbar");
  if (topbar) topbar.hidden = (screenId === "screen-admin" || screenId === "screen-admin-login");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* شاشات تتطلب تسجيل دخول اللاعب أولًا */
const PLAYER_ONLY_SCREENS = new Set([
  "screen-categories", "screen-mp-list", "screen-mp-room", "screen-quiz",
  "screen-results", "screen-dashboard", "screen-profile", "screen-leaderboard", "screen-room-rankings",
  "screen-suggest-question", "screen-random-rolling", "screen-random-preview", "screen-random-leaderboard",
  "screen-marathon-waiting", "screen-marathon-quiz", "screen-marathon-eliminated", "screen-marathon-spectator",
  "screen-marathon-results", "screen-marathon-leaderboard",
]);

function guardedGoTo(screenId){
  if (PLAYER_ONLY_SCREENS.has(screenId) && !AppState.profile){
    showToast("الرجاء تسجيل الدخول أولًا");
    goTo("screen-welcome");
    return;
  }
  goTo(screenId);
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function showToast(msg){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ---------------- confetti (lightweight canvas) ---------------- */
const confettiCanvas = document.getElementById("confetti-canvas");
const ctx2d = confettiCanvas ? confettiCanvas.getContext("2d") : null;
let confettiParticles = [];
let confettiRunning = false;

function resizeConfettiCanvas(){
  if (!confettiCanvas) return;
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeConfettiCanvas);
resizeConfettiCanvas();

function fireConfettiBurst(count = 26){
  if (!ctx2d) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#6d5bff", "#ff5c8a", "#ffb020", "#00b6a2"];
  for (let i = 0; i < count; i++){
    confettiParticles.push({
      x: confettiCanvas.width / 2 + (Math.random() - 0.5) * 200,
      y: confettiCanvas.height * 0.35,
      vx: (Math.random() - 0.5) * 8,
      vy: Math.random() * -6 - 2,
      size: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      life: 0,
    });
  }
  if (!confettiRunning) runConfetti();
}

function fireConfettiCelebration(){
  fireConfettiBurst(60);
  setTimeout(() => fireConfettiBurst(40), 200);
}

function runConfetti(){
  confettiRunning = true;
  ctx2d.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiParticles.forEach(p => {
    p.vy += 0.15;
    p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life += 1;
    ctx2d.save();
    ctx2d.translate(p.x, p.y);
    ctx2d.rotate(p.rot);
    ctx2d.fillStyle = p.color;
    ctx2d.globalAlpha = Math.max(0, 1 - p.life / 90);
    ctx2d.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
    ctx2d.restore();
  });
  confettiParticles = confettiParticles.filter(p => p.life < 90 && p.y < confettiCanvas.height + 40);
  if (confettiParticles.length){
    requestAnimationFrame(runConfetti);
  } else {
    confettiRunning = false;
    ctx2d.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

/* ---------------- modal helpers ---------------- */
function openModal(id){ document.getElementById(id).hidden = false; }
function closeModal(id){ document.getElementById(id).hidden = true; }

/* ---------------- quiz countdown (3, 2, 1, GO!) ---------------- */
function prefersReducedMotion(){
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function playQuizCountdown(){
  return new Promise((resolve) => {
    const overlay = document.getElementById("quiz-countdown-overlay");
    const numEl = document.getElementById("quiz-countdown-number");
    if (!overlay || !numEl){ resolve(); return; }

    // من يفضّلون تقليل الحركة: نتخطى العدّ التنازلي البصري بالكامل فورًا،
    // بلا أي تأخير مصطنع، مع الإبقاء على الانتقال المباشر لبدء الاختبار
    if (prefersReducedMotion()){ resolve(); return; }

    overlay.hidden = false;
    const steps = ["3", "2", "1", "GO!"];
    let i = 0;
    function showNext(){
      numEl.textContent = steps[i];
      numEl.classList.remove("quiz-countdown-number"); void numEl.offsetWidth;
      numEl.classList.add("quiz-countdown-number");
      if (steps[i] === "GO!") QVSound.go(); else QVSound.countdown();
      i += 1;
      if (i < steps.length){
        setTimeout(showNext, 650);
      } else {
        setTimeout(() => { overlay.hidden = true; resolve(); }, 450);
      }
    }
    showNext();
  });
}

/* ---------------- level up popup ---------------- */
function showLevelUpPopup(level){
  return new Promise((resolve) => {
    const overlay = document.getElementById("level-up-overlay");
    if (!overlay){ resolve(); return; }
    document.getElementById("level-up-emoji").textContent = level.emoji;
    document.getElementById("level-up-title").textContent = level.name;
    overlay.hidden = false;
    QVSound.levelUp();
    const holdTime = prefersReducedMotion() ? 900 : 2200;
    setTimeout(() => { overlay.hidden = true; resolve(); }, holdTime);
  });
}

/* ---------------- sound settings (player settings page) ---------------- */
function initSoundSettings(){
  const s = QVSound.getSettings();
  const sfxToggle = document.getElementById("snd-sfx-toggle");
  const sfxSlider = document.getElementById("snd-sfx-volume");
  const sfxValue = document.getElementById("snd-sfx-value");
  if (!sfxToggle) return;

  sfxToggle.checked = s.sfxEnabled;
  sfxSlider.value = Math.round(s.sfxVolume * 100);
  sfxValue.textContent = sfxSlider.value + "%";

  sfxToggle.addEventListener("change", () => {
    QVSound.setSfxEnabled(sfxToggle.checked);
    if (sfxToggle.checked) QVSound.click();
  });
  sfxSlider.addEventListener("input", () => {
    sfxValue.textContent = sfxSlider.value + "%";
    QVSound.setSfxVolume(Number(sfxSlider.value) / 100);
  });
  sfxSlider.addEventListener("change", () => QVSound.click());
}

/* ---------------- theme (تبديل بين المظهر الفاتح والداكن) ---------------- */
function initTheme(){
  const saved = localStorage.getItem("qv_theme");
  const theme = saved || "light";
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
}
function toggleTheme(){
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("qv_theme", next);
  updateThemeIcon(next);
}
function updateThemeIcon(theme){
  document.getElementById("btn-theme").textContent = theme === "light" ? "🌙" : "☀️";
}

/* ---------------- header score pill ---------------- */
function updateHeaderScore(){
  const pill = document.getElementById("header-score");
  if (AppState.profile){
    pill.hidden = false;
    document.getElementById("header-score-value").textContent = AppState.profile.total_score || 0;
  } else {
    pill.hidden = true;
  }
}

/* ---------------- avatar picker (shared: register + profile) ---------------- */
function renderAvatarPicker(containerId, selected, onSelect){
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = "";
  QUIZVERSE_AVATARS.forEach(av => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-chip" + (av === selected ? " selected" : "");
    btn.textContent = av;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", av === selected ? "true" : "false");
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".avatar-chip").forEach(c => { c.classList.remove("selected"); c.setAttribute("aria-checked","false"); });
      btn.classList.add("selected");
      btn.setAttribute("aria-checked", "true");
      QVSound.click();
      onSelect(av);
    });
    wrap.appendChild(btn);
  });
}

/* ---------------- age chip helper (shared) ---------------- */
function initAgeGrid(gridId, onSelect){
  const grid = document.getElementById(gridId);
  grid.querySelectorAll(".age-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      grid.querySelectorAll(".age-chip").forEach(c => c.setAttribute("aria-checked", "false"));
      chip.setAttribute("aria-checked", "true");
      QVSound.click();
      onSelect(chip.dataset.age);
    });
  });
}

/* ---------------- welcome screen entry buttons ---------------- */
function initWelcomeEntry(){
  document.getElementById("btn-goto-register").addEventListener("click", () => { QVSound.click(); goTo("screen-register"); });
  document.getElementById("btn-goto-login").addEventListener("click", () => { QVSound.click(); goTo("screen-login"); });
  document.getElementById("btn-goto-admin").addEventListener("click", () => { QVSound.click(); goTo("screen-admin-login"); });
}

/* ---------------- register screen ---------------- */
let regSelectedAge = null;
let regSelectedAvatar = QUIZVERSE_AVATARS[0];

function initRegister(){
  renderAvatarPicker("reg-avatar-grid", regSelectedAvatar, (av) => regSelectedAvatar = av);
  initAgeGrid("reg-age-grid", (age) => regSelectedAge = age);

  document.getElementById("form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("reg-username").value.trim();
    const pass1 = document.getElementById("reg-password").value;
    const pass2 = document.getElementById("reg-password2").value;

    const errUsername = document.getElementById("err-reg-username");
    const errPass = document.getElementById("err-reg-password");
    const errAge = document.getElementById("err-reg-age");
    const errGeneral = document.getElementById("err-register");
    [errUsername, errPass, errAge, errGeneral].forEach(el => el.textContent = "");

    let valid = true;
    if (!regSelectedAge){ errAge.textContent = "الرجاء اختيار الفئة العمرية"; valid = false; }
    if (pass1 !== pass2){ errPass.textContent = "كلمتا المرور غير متطابقتين"; valid = false; }
    if (!valid) return;

    try{
      const profile = await QV.signUp({ username, password: pass1, age: regSelectedAge, avatar: regSelectedAvatar });
      AppState.profile = profile;
      updateHeaderScore();
      showToast(`أهلًا بك ${profile.username}! تم إنشاء حسابك بنجاح 🎉`);
      await renderDashboard();
      goTo("screen-dashboard");
      e.target.reset();
    }catch(err){
      errGeneral.textContent = err.message || "تعذّر إنشاء الحساب";
    }
  });
}

/* ---------------- login screen ---------------- */
function initLogin(){
  document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errEl = document.getElementById("err-login");
    errEl.textContent = "";
    try{
      const profile = await QV.signIn({ username, password });
      AppState.profile = profile;
      updateHeaderScore();
      showToast(`أهلًا بعودتك ${profile.username} 👋`);
      await renderDashboard();
      goTo("screen-dashboard");
      e.target.reset();
    }catch(err){
      errEl.textContent = err.message || "تعذّر تسجيل الدخول";
    }
  });
}

/* ---------------- dashboard ---------------- */
async function renderDashboard(){
  const p = AppState.profile;
  if (!p) return;
  const level = QV.levelForScore(p.total_score || 0);
  const rank = await QV.getRank(p.id);

  document.getElementById("dash-avatar").textContent = p.avatar || "🙂";
  document.getElementById("dash-level-badge").textContent = `${level.name} ${level.emoji}`;
  document.getElementById("dash-greeting").textContent = `أهلًا بعودتك، ${p.username} 👋`;
  document.getElementById("dash-subtext").textContent = p.games_played
    ? `أكملت ${p.games_played} اختبارًا حتى الآن — استمر!`
    : "جاهز لأول تحدٍ معرفي لك؟";

  // يخفي المشرف زر اقتراح الأسئلة عن لاعبين محدّدين (راجع إدارة اللاعبين ←
  // "🔒 حظر الاقتراحات") — لا يؤثر على أي صلاحية أخرى للاعب إطلاقًا
  document.getElementById("btn-dash-suggest").hidden = !!p.suggestions_locked;

  // زر التحدي العشوائي: يعرض عدد المحاولات المتبقية اليوم (محاولتان كحد
  // أقصى)، ويُعطَّل تلقائيًا بعد استنفادهما حتى يُفتحان من جديد غدًا
  const rcBtn = document.getElementById("btn-dash-random-challenge");
  if (rcBtn){
    const remaining = QV.randomChallengeRemainingToday(p);
    rcBtn.disabled = remaining <= 0;
    rcBtn.textContent = remaining > 0 ? `🎲 تحدي عشوائي (${remaining} متبقٍ اليوم)` : "🎲 تحدي عشوائي (غدًا مجددًا)";
  }

  document.getElementById("dash-stats").innerHTML = `
    <div class="stat-card"><strong>${p.total_score || 0}</strong><span>🏆 إجمالي النقاط</span></div>
    <div class="stat-card"><strong>${rank ? "#" + rank : "—"}</strong><span>🥇 الترتيب الحالي</span></div>
    <div class="stat-card"><strong>${p.games_played || 0}</strong><span>🎮 اختبارات مكتملة</span></div>
    <div class="stat-card"><strong>${p.correct_answers || 0}</strong><span>✅ إجابات صحيحة</span></div>
    <div class="stat-card"><strong>${p.streak || 0}</strong><span>🔥 سلسلة أيام اللعب</span></div>
    <div class="stat-card"><strong>${level.name}</strong><span>⭐ المستوى</span></div>
  `;

  const history = await QV.getGameHistory(p.id, 6);
  const histEl = document.getElementById("dash-history");
  histEl.innerHTML = history.length ? history.map(h => `
    <div class="history-row">
      <span class="history-cat">${catIcon(h.category)} ${catName(h.category)}</span>
      <span class="history-score">${h.score} نقطة</span>
      <span class="history-date muted">${formatDate(h.played_at)}</span>
    </div>
  `).join("") : `<p class="muted">لم تلعب أي اختبار بعد — ابدأ الآن!</p>`;

  renderAchievements("dash-achievements", p, rank);

  try{ await Marathon.renderDashboardAnnouncement(); }catch(e){ console.warn("تعذّر عرض إعلان الماراثون", e); }
}

function formatDate(iso){
  try{
    const d = new Date(iso);
    return d.toLocaleDateString("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric" });
  }catch(e){ return ""; }
}

function renderAchievements(containerId, profile, rank){
  const list = QV.computeAchievements(profile, rank);
  const el = document.getElementById(containerId);
  el.innerHTML = list.map(a => `
    <div class="achv-badge ${a.unlocked ? "unlocked" : "locked"}">
      <span class="achv-icon">${a.unlocked ? a.icon : "🔒"}</span>
      <span class="achv-name">${escapeHtml(a.name)}</span>
      <p class="achv-desc">${escapeHtml(a.desc)}</p>
    </div>
  `).join("");
}

function initDashboardActions(){
  document.getElementById("btn-dash-play").addEventListener("click", () => {
    renderCategories();
    guardedGoTo("screen-categories");
  });
  document.getElementById("btn-dash-group-play").addEventListener("click", () => {
    const p = AppState.profile;
    if (!p) return;
    Multiplayer.renderList({ name: p.username, age: p.age, avatar: p.avatar, userId: p.id });
    guardedGoTo("screen-mp-list");
  });
  document.getElementById("btn-dash-profile").addEventListener("click", async () => {
    await renderProfile();
    guardedGoTo("screen-profile");
  });
  document.getElementById("btn-dash-suggest").addEventListener("click", () => {
    resetSuggestForm();
    guardedGoTo("screen-suggest-question");
  });
  document.getElementById("btn-dash-random-challenge").addEventListener("click", () => {
    startRandomChallengeFlow();
  });
}

/* ---------------- profile screen ---------------- */
async function renderProfile(){
  const p = AppState.profile;
  if (!p) return;
  const level = QV.levelForScore(p.total_score || 0);
  const rank = await QV.getRank(p.id);

  renderAvatarPicker("profile-avatar-grid", p.avatar, async (av) => {
    try{
      AppState.profile = await QV.updateProfile(p.id, { avatar: av });
      showToast("تم تحديث الصورة الرمزية ✔");
    }catch(err){ showToast("تعذّر تحديث الصورة الرمزية"); }
  });

  document.getElementById("profile-username").textContent = p.username;
  document.getElementById("profile-age").textContent = p.age || "—";
  document.getElementById("profile-level").textContent = `${level.name} ${level.emoji}`;
  document.getElementById("profile-rank").textContent = rank ? "#" + rank : "—";
  document.getElementById("profile-score").textContent = p.total_score || 0;
  document.getElementById("profile-favcat").textContent = p.favorite_category ? (catIcon(p.favorite_category) + " " + catName(p.favorite_category)) : "لم يُحدَّد بعد";
  document.getElementById("pf-age-display").textContent = p.age || "—";

  renderRandomChallengeStats(p);
  renderMarathonProfileStats(p);
  renderAchievements("profile-achievements", p, rank);
}

function renderRandomChallengeStats(p){
  const grid = document.getElementById("rc-profile-stats");
  if (!grid) return;
  const bestCategory = p.random_challenge_best_category
    ? `${catIcon(p.random_challenge_best_category)} ${catName(p.random_challenge_best_category)}`
    : "—";
  grid.innerHTML = `
    <div class="stat-card"><strong>${p.random_challenges_played || 0}</strong><span>🎲 تحديات مكتملة</span></div>
    <div class="stat-card"><strong>${p.random_challenges_won || 0}</strong><span>🏆 تحديات مربوحة</span></div>
    <div class="stat-card"><strong>${p.random_challenge_best_score || 0}</strong><span>⭐ أفضل نتيجة</span></div>
    <div class="stat-card"><strong>${bestCategory}</strong><span>📚 أفضل فئة</span></div>
  `;
}

function renderMarathonProfileStats(p){
  const grid = document.getElementById("mar-profile-stats");
  if (!grid) return;
  grid.innerHTML = `
    <div class="stat-card"><strong>${p.marathons_joined || 0}</strong><span>🏁 ماراثونات مشارَك بها</span></div>
    <div class="stat-card"><strong>${p.marathon_wins || 0}</strong><span>👑 ماراثونات مربوحة</span></div>
    <div class="stat-card"><strong>${p.marathon_best_rank ? "#" + p.marathon_best_rank : "—"}</strong><span>🏅 أفضل ترتيب</span></div>
    <div class="stat-card"><strong>${p.marathon_highest_streak || 0}</strong><span>🔥 أعلى سلسلة صمود</span></div>
    <div class="stat-card"><strong>${p.marathon_best_score || 0}</strong><span>⭐ أفضل نتيجة ماراثون</span></div>
  `;
}

function initProfileForms(){
  document.getElementById("form-change-password").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("err-change-password");
    errEl.textContent = "";
    const p1 = document.getElementById("pf-newpass").value;
    const p2 = document.getElementById("pf-newpass2").value;
    if (p1 !== p2){ errEl.textContent = "كلمتا المرور غير متطابقتين"; return; }
    try{
      await QV.changePassword(p1);
      showToast("تم تحديث كلمة المرور ✔");
      e.target.reset();
    }catch(err){
      errEl.textContent = err.message || "تعذّر تحديث كلمة المرور";
    }
  });

  document.getElementById("btn-logout").addEventListener("click", async () => {
    await QV.signOut();
    AppState.profile = null;
    updateHeaderScore();
    showToast("تم تسجيل الخروج");
    goTo("screen-welcome");
  });
}

/* ---------------- category screen ---------------- */
const CATEGORY_COLORS = {
  science:    "#6d5bff",
  technology: "#00b6c9",
  history:    "#ff8a3d",
  geography:  "#22c55e",
  culture:    "#ff5c8a",
  body:       "#f43f5e",
  sports:     "#f5b301",
  ai:         "#a855f7",
  religion:   "#0d9488",
  quran:      "#059669",
  spacetoon:  "#2563eb",
  spatial:    "#c026d3",
};

function renderCategories(){
  const grid = document.getElementById("category-grid");
  grid.innerHTML = "";
  AppState.selectedCategory = null;
  document.getElementById("greet-name").textContent = AppState.profile ? AppState.profile.username : "";
  QUIZ_CATEGORIES.forEach(cat => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-card";
    btn.style.setProperty("--cat-color", CATEGORY_COLORS[cat.id] || "#6d5bff");
    btn.innerHTML = `
      <span class="cat-icon">${cat.icon}</span>
      <span class="cat-name">${cat.name}</span>
      <span class="cat-count">اضغط للاختيار</span>
    `;
    btn.addEventListener("click", () => {
      grid.querySelectorAll(".category-card").forEach(c => c.classList.remove("selected"));
      btn.classList.add("selected");
      AppState.selectedCategory = cat.id;
      QVSound.click();
      updateStartQuizButtonState();
    });
    grid.appendChild(btn);
  });
  updateStartQuizButtonState();
}

/* ---------------- start-quiz button (mode -> level -> category -> start) ---------------- */
function updateStartQuizButtonState(){
  const btn = document.getElementById("btn-start-quiz");
  const hint = document.getElementById("start-quiz-hint");
  if (!btn) return;

  if (!AppState.selectedCategory){
    btn.disabled = true;
    hint.textContent = "اختر فئة لتفعيل زر البدء";
    return;
  }
  if (AppState.profile){
    const allowed = QV.canPlay(AppState.profile, AppState.selectedCategory, AppState.selectedDifficulty);
    if (!allowed){
      btn.disabled = true;
      hint.textContent = "لقد لعبت هذه الفئة بهذا المستوى اليوم بالفعل — ستُفتح تلقائيًا غدًا، أو تواصل مع المشرف لمنحك محاولة إضافية الآن.";
      return;
    }
  }
  btn.disabled = false;
  hint.textContent = "جاهز؟ اضغط ابدأ الاختبار 🚀";
}

function initStartQuizButton(){
  document.getElementById("btn-start-quiz").addEventListener("click", () => {
    QVSound.click();
    if (!AppState.selectedCategory) return;
    if (!QV.canPlay(AppState.profile, AppState.selectedCategory, AppState.selectedDifficulty)){
      showToast("لقد لعبت هذه الفئة بهذا المستوى اليوم بالفعل — ستُفتح تلقائيًا غدًا، أو تواصل مع المشرف لمنحك محاولة إضافية الآن.");
      updateStartQuizButtonState();
      return;
    }
    startSoloQuiz();
  });
}

function initCategoryControls(){
  document.getElementById("difficulty-row").querySelectorAll(".diff-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".diff-chip").forEach(c => c.setAttribute("aria-checked", "false"));
      chip.setAttribute("aria-checked", "true");
      AppState.selectedDifficulty = chip.dataset.diff;
      QVSound.click();
      updateStartQuizButtonState();
    });
  });
}

/* ---------------- quiz flow ---------------- */
async function startSoloQuiz(){
  goTo("screen-quiz");
  await playQuizCountdown();
  QVSound.start();
  const p = AppState.profile;
  const range = ageGroupToRange(p.age);
  const [counts, timePerQuestion] = await Promise.all([
    QV.getQuestionCounts(),
    QV.resolveQuestionTimer({ age: range.min, category: AppState.selectedCategory }),
  ]);
  const count = counts[AppState.selectedCategory] || QUIZVERSE_CONFIG.DEFAULT_QUESTIONS_PER_QUIZ;
  const comboKey = AppState.selectedCategory + ":" + AppState.selectedDifficulty;
  const excludeIds = (p.recent_questions && p.recent_questions[comboKey]) || [];
  const ok = await QuizEngine.start({
    category: AppState.selectedCategory,
    difficulty: AppState.selectedDifficulty,
    ageMin: range.min,
    ageMax: range.max,
    count,
    excludeIds,
    timePerQuestion,
    age: range.min,
    onFinish: (result) => window.onQuizFinished(result, false),
  });
  if (!ok) { renderCategories(); goTo("screen-categories"); }
}

/* ---------------- 🎲 Random Challenge (فئة/مستوى/عدد أسئلة/مؤقت عشوائي بالكامل) ---------------- */
const RANDOM_CHALLENGE_COUNT_OPTIONS = [5, 10, 15, 20];
let currentRandomChallenge = null; // آخر تحدٍ عشوائي تم اختياره، بانتظار "ابدأ التحدي"

/* يبني تحديًا عشوائيًا صالحًا فعليًا: فئة فيها أسئلة كافية لعمر اللاعب، مستوى
   صعوبة متاح ضمن تلك الفئة (مع تراجع تلقائي لمستوى آخر إن لم يوجد عدد كافٍ)،
   وعدد أسئلة من {5, 10, 15, 20} لا يتجاوز عدد الأسئلة المتوفرة فعلاً. */
async function pickRandomChallenge(profile){
  const range = ageGroupToRange(profile.age);
  // نجلب كل الأسئلة المطابقة لعمر اللاعب مرة واحدة عبر كل الفئات، ثم نُجمّعها
  // محليًا حسب الفئة/المستوى بدل تكرار الاستعلام لكل فئة على حدة
  const allQuestions = await QV.getQuestions({ ageMin: range.min, ageMax: range.max });
  if (!allQuestions.length) return null;

  const byCategory = {};
  allQuestions.forEach(q => {
    byCategory[q.category] = byCategory[q.category] || {};
    const d = q.difficulty || "medium";
    byCategory[q.category][d] = (byCategory[q.category][d] || 0) + 1;
  });

  const eligibleCategories = QUIZ_CATEGORIES.filter(c => byCategory[c.id]);
  if (!eligibleCategories.length) return null;

  const category = QV.shuffle(eligibleCategories.slice())[0].id;
  const diffCounts = byCategory[category];
  const shuffledDiffs = QV.shuffle(["easy", "medium", "hard"]);
  // نفضّل مستوى فيه 3 أسئلة على الأقل ليكون تحديًا معقولاً، وإلا أي مستوى
  // متاح فيه سؤال واحد على الأقل (تراجع تلقائي كما هو مطلوب)
  const difficulty = shuffledDiffs.find(d => (diffCounts[d] || 0) >= 3) || shuffledDiffs.find(d => (diffCounts[d] || 0) > 0);
  if (!difficulty) return null;

  const available = diffCounts[difficulty];
  const validCounts = RANDOM_CHALLENGE_COUNT_OPTIONS.filter(n => n <= available);
  const questionCount = validCounts.length ? QV.shuffle(validCounts.slice())[0] : available;

  const timePerQuestion = await QV.resolveQuestionTimer({ age: range.min, category });

  return { category, difficulty, questionCount, timePerQuestion, ageRange: range };
}

async function startRandomChallengeFlow(){
  const p = AppState.profile;
  if (!p) return;

  if (!QV.canPlayRandomChallenge(p)){
    showToast("لقد استخدمت محاولتيك للتحدي العشوائي اليوم — ستُفتحان تلقائيًا غدًا 🎲");
    return;
  }

  guardedGoTo("screen-random-rolling");
  QVSound.click();

  // نُبقي حركة النرد الدوّارة ظاهرة لثانية واحدة على الأقل حتى لو كان
  // اختيار التحدي فوريًا، حتى تبدو تجربة "البحث" طبيعية وليست قفزة مفاجئة
  const [picked] = await Promise.all([
    pickRandomChallenge(p),
    new Promise(resolve => setTimeout(resolve, 1000)),
  ]);

  if (!picked){
    showToast("لا توجد أسئلة كافية لبناء تحدٍ عشوائي لفئتك العمرية حاليًا");
    await renderDashboard();
    goTo("screen-dashboard");
    return;
  }

  currentRandomChallenge = picked;
  const diffLabel = { easy: "سهل", medium: "متوسط", hard: "صعب" }[picked.difficulty] || picked.difficulty;
  document.getElementById("rc-preview-category").textContent = `${catIcon(picked.category)} ${catName(picked.category)}`;
  document.getElementById("rc-preview-difficulty").textContent = diffLabel;
  document.getElementById("rc-preview-count").textContent = `${picked.questionCount} سؤال`;
  document.getElementById("rc-preview-time").textContent = `${picked.timePerQuestion} ثانية`;

  goTo("screen-random-preview");
}

function initRandomChallenge(){
  document.getElementById("btn-start-random-challenge").addEventListener("click", async () => {
    if (!currentRandomChallenge) return;
    const picked = currentRandomChallenge;
    const p = AppState.profile;

    goTo("screen-quiz");
    await playQuizCountdown();
    QVSound.start();
  
    const comboKey = picked.category + ":" + picked.difficulty;
    const excludeIds = (p.recent_questions && p.recent_questions[comboKey]) || [];
    const ok = await QuizEngine.start({
      category: picked.category,
      difficulty: picked.difficulty,
      ageMin: picked.ageRange.min,
      ageMax: picked.ageRange.max,
      count: picked.questionCount,
      excludeIds,
      timePerQuestion: picked.timePerQuestion,
      age: picked.ageRange.min,
      onFinish: (result) => window.onQuizFinished(result, false, null, true),
    });
    if (!ok){ goTo("screen-dashboard"); }
  });
}

window.onQuizFinished = async function(result, isMultiplayer, gameId, isRandomChallenge){

  // اللعب المباشر: مكافأة سرعة بسيطة تُضاف لنقاط الاختبار الجماعي بحسب
  // متوسط زمن الإجابة (كلما كان اللاعب أسرع زادت المكافأة) — لا تُطبَّق على
  // الاختبارات الفردية حتى لا يتغيّر نظام نقاطها الحالي إطلاقًا
  if (isMultiplayer && gameId && result.correctCount > 0){
    const speedBonus = Math.max(0, Math.round((12 - result.avgTime) * 2));
    if (speedBonus > 0) result.score += speedBonus;
  }

  // 🎲 مكافأة التحدي العشوائي: +20% نقاط إضافية دائمًا عند إكماله، و+100 نقطة
  // إضافية إن كانت كل الإجابات صحيحة (إتمام مثالي) — تُضاف فوق النقاط
  // الأصلية تمامًا كمكافأة السرعة أعلاه، دون أي تعديل على طريقة احتسابها
  let randomChallengeBonus = 0;
  if (isRandomChallenge){
    randomChallengeBonus = Math.round(result.score * 0.2);
    if (result.total > 0 && result.correctCount === result.total) randomChallengeBonus += 100;
    if (randomChallengeBonus > 0) result.score += randomChallengeBonus;
  }

  // مستوى اللاعب *قبل* إضافة هذه النتيجة لنقاطه الإجمالية — للمقارنة بعد
  // الحفظ ومعرفة إن كانت هذه النتيجة كافية لترقية مستواه
  const levelBefore = AppState.profile ? QV.levelForScore(AppState.profile.total_score || 0).name : null;

  const level = QV.levelForScore(result.score);
  document.getElementById("results-level").textContent = level.name;
  document.getElementById("results-emoji").textContent = level.emoji;
  document.getElementById("results-score-value").textContent = result.score;
  document.getElementById("results-correct").textContent = result.correctCount;
  document.getElementById("results-wrong").textContent = result.wrongCount;
  document.getElementById("results-time").textContent = result.avgTime + "s";

  goTo("screen-results");
  if (result.score > 0) fireConfettiCelebration();
  QVSound.win();
  if (randomChallengeBonus > 0){
    setTimeout(() => showToast(`🎲 مكافأة التحدي العشوائي: +${randomChallengeBonus} نقطة إضافية!`), 900);
  }

  try{
    const { profile, newlyUnlocked } = await QV.submitQuizResult({
      userId: AppState.profile.id, result, gameId,
    });
    AppState.profile = profile;
    updateHeaderScore();
    updateStartQuizButtonState();

    // إحصائيات وضع التحدي العشوائي منفصلة تمامًا — تُحدَّث فقط بعد نجاح حفظ
    // النتيجة العادية أعلاه، ولا تؤثر على أي حقل آخر في الملف الشخصي
    if (isRandomChallenge){
      try{
        AppState.profile = await QV.submitRandomChallengeResult(AppState.profile.id, {
          score: result.score, correctCount: result.correctCount, total: result.total,
          avgTime: result.avgTime, category: result.category,
        });
      }catch(e){ console.warn("تعذّر حفظ إحصائيات التحدي العشوائي", e); }
    }

    // ترقية المستوى: نقارن مستوى اللاعب قبل وبعد حفظ هذه النتيجة — إن تغيّر
    // اسم المستوى (مبتدئ ← متعلم ← خبير ← عبقري) نعرض احتفال "ترقية مستوى"
    const levelAfter = QV.levelForScore(AppState.profile.total_score || 0);
    if (levelBefore && levelAfter.name !== levelBefore){
      await showLevelUpPopup(levelAfter);
      updateHeaderScore();
    }

    if (isMultiplayer && gameId){
      // نحدّث نتيجة اللاعب داخل صف الغرفة نفسها لتنعكس فورًا في ترتيب أفضل
      // 3 لاعبين وفي شاشة "ترتيب الغرف"، ثم نحتسب مكافأة الترتيب الفوري:
      // 🥇 الأول +50، 🥈 الثاني +30، 🥉 الثالث +15 نقطة إضافية
      QV.updateGamePlayerScore(gameId, AppState.profile.id, result.score)
        .then(() => QV.awardRoomPlacementBonus(gameId, AppState.profile.id))
        .then(async (bonus) => {
          if (bonus > 0){
            AppState.profile = await QV.getProfile(AppState.profile.id);
            updateHeaderScore();
            const medal = bonus >= 50 ? "🥇" : bonus >= 30 ? "🥈" : "🥉";
            showToast(`${medal} مكافأة الترتيب: +${bonus} نقطة إضافية!`);
          }
        })
        .catch(() => {});
    }
    if (newlyUnlocked && newlyUnlocked.length){
      const names = newlyUnlocked.map(id => (QUIZVERSE_ACHIEVEMENTS.find(a => a.id === id) || {}).name).filter(Boolean);
      if (names.length){
        QVSound.achievement();
        setTimeout(() => showToast("إنجاز جديد مفتوح: " + names.join("، ") + " 🏅"), 1200);
      }
    }
  }catch(e){ console.warn("تعذّر حفظ النتيجة", e); }
};

function initResultsActions(){
  document.getElementById("btn-retry").addEventListener("click", () => {
    if (!QV.canPlay(AppState.profile, AppState.selectedCategory, AppState.selectedDifficulty)){
      showToast("لقد استخدمت محاولتك لهذه الفئة والمستوى اليوم — ستُفتح تلقائيًا غدًا، أو تواصل مع المشرف لمحاولة إضافية الآن.");
      renderCategories();
      guardedGoTo("screen-categories");
      return;
    }
    startSoloQuiz();
  });
  document.getElementById("btn-to-categories").addEventListener("click", () => { renderCategories(); guardedGoTo("screen-categories"); });
  document.getElementById("btn-to-leaderboard").addEventListener("click", () => { goTo("screen-leaderboard"); Leaderboard.render(); });
  document.getElementById("btn-to-dashboard").addEventListener("click", async () => { await renderDashboard(); guardedGoTo("screen-dashboard"); });
}

/* ---------------- header buttons ---------------- */
function initHeader(){
  document.getElementById("btn-home").addEventListener("click", async () => {
    if (AppState.profile){ await renderDashboard(); goTo("screen-dashboard"); }
    else goTo("screen-welcome");
  });
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);
  document.getElementById("btn-header-room-rankings").addEventListener("click", async () => {
    guardedGoTo("screen-room-rankings");
    await Multiplayer.renderRoomRankingsScreen();
  });
  document.getElementById("btn-header-leaderboard").addEventListener("click", async () => {
    guardedGoTo("screen-leaderboard");
    await Leaderboard.render();
  });
  document.getElementById("btn-header-random-leaderboard").addEventListener("click", async () => {
    guardedGoTo("screen-random-leaderboard");
    await Leaderboard.renderRandomChallenge();
  });
  document.getElementById("btn-header-marathon-leaderboard").addEventListener("click", async () => {
    guardedGoTo("screen-marathon-leaderboard");
    await Marathon.renderLeaderboard();
  });
}

/* ---------------- back buttons ---------------- */
function initBackButtons(){
  document.querySelectorAll("[data-back]").forEach(btn => {
    btn.addEventListener("click", () => guardedGoTo(btn.dataset.back));
  });
}

/* ---------------- suggest-a-question (player-submitted, admin-reviewed) ---------------- */
let sgPairIdx = 0, sgItemIdx = 0;

function initSuggestQuestion(){
  const catSel = document.getElementById("sg-category");
  catSel.innerHTML = QUIZ_CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");

  document.getElementById("sg-type").addEventListener("change", (e) => applySgTypeUI(e.target.value));
  document.getElementById("btn-sg-add-pair").addEventListener("click", () => addSgPairRow());
  document.getElementById("btn-sg-add-item").addEventListener("click", () => addSgItemRow());
  document.getElementById("form-suggest-question").addEventListener("submit", onSubmitSuggestion);
}

function resetSuggestForm(){
  const form = document.getElementById("form-suggest-question");
  form.reset();
  document.getElementById("sg-err").textContent = "";
  document.getElementById("sg-pairs-list").innerHTML = "";
  document.getElementById("sg-items-list").innerHTML = "";
  sgPairIdx = 0; sgItemIdx = 0;
  addSgPairRow(); addSgPairRow();
  addSgItemRow(); addSgItemRow(); addSgItemRow();
  applySgTypeUI("multiple_choice");
}

function applySgTypeUI(type){
  document.getElementById("sg-group-mc").hidden = type !== "multiple_choice";
  document.getElementById("sg-group-tf").hidden = type !== "true_false";
  document.getElementById("sg-group-matching").hidden = type !== "matching";
  document.getElementById("sg-group-ordering").hidden = type !== "ordering";
}

function addSgPairRow(left, right){
  const id = "sgp" + (sgPairIdx++);
  const row = document.createElement("div");
  row.className = "field-grid";
  row.style.marginBottom = "8px";
  row.innerHTML = `
    <div class="field"><input placeholder="العنصر" id="${id}-l" value="${escapeHtml(left || "")}"></div>
    <div class="field" style="display:flex;gap:6px">
      <input placeholder="الإجابة الصحيحة له" id="${id}-r" value="${escapeHtml(right || "")}">
      <button type="button" class="btn btn-ghost" data-remove-row>✖</button>
    </div>
  `;
  row.querySelector("[data-remove-row]").addEventListener("click", () => row.remove());
  document.getElementById("sg-pairs-list").appendChild(row);
}

function addSgItemRow(value){
  const id = "sgi" + (sgItemIdx++);
  const row = document.createElement("div");
  row.className = "field";
  row.style.display = "flex";
  row.style.gap = "6px";
  row.style.marginBottom = "8px";
  row.innerHTML = `
    <input placeholder="عنصر بالترتيب الصحيح" id="${id}" value="${escapeHtml(value || "")}" style="flex:1">
    <button type="button" class="btn btn-ghost" data-remove-row>✖</button>
  `;
  row.querySelector("[data-remove-row]").addEventListener("click", () => row.remove());
  document.getElementById("sg-items-list").appendChild(row);
}

async function onSubmitSuggestion(e){
  e.preventDefault();
  const errEl = document.getElementById("sg-err");
  errEl.textContent = "";

  // شبكة أمان إضافية (إلى جانب إخفاء الزر في لوحة اللاعب): حتى لو وصل اللاعب
  // لهذه الشاشة بأي طريقة بعد أن أوقف المشرف اقتراحاته، تُرفض المحاولة هنا أيضًا
  if (AppState.profile && AppState.profile.suggestions_locked){
    errEl.textContent = "تم إيقاف إمكانية إرسال اقتراحات الأسئلة لحسابك من قبل المشرف";
    return;
  }

  const type = document.getElementById("sg-type").value;
  const question = document.getElementById("sg-text").value.trim();
  if (!question){
    errEl.textContent = "الرجاء كتابة نص السؤال";
    return;
  }

  const payload = {
    type,
    question,
    category: document.getElementById("sg-category").value,
    difficulty: document.querySelector('input[name="sg-level"]:checked').value,
    age_min: 5, age_max: 99, points: 10, explanation: "",
    // اقتراحات اللاعبين تُحفظ دائمًا بحالة "قيد المراجعة" — لن تظهر ضمن أي
    // اختبار فعلي إطلاقًا حتى يوافق عليها المشرف أو أحد المشرفين الفرعيين
    status: "pending",
    suggested_by: AppState.profile ? AppState.profile.username : null,
    option1: null, option2: null, option3: null, option4: null,
    correct_answer: null, pairs: null, ordered_items: null,
  };

  if (type === "multiple_choice"){
    payload.option1 = document.getElementById("sg-opt1").value.trim();
    payload.option2 = document.getElementById("sg-opt2").value.trim();
    payload.option3 = document.getElementById("sg-opt3").value.trim();
    payload.option4 = document.getElementById("sg-opt4").value.trim();
    if (!payload.option1 || !payload.option2 || !payload.option3 || !payload.option4){
      errEl.textContent = "الرجاء تعبئة الخيارات الأربعة";
      return;
    }
    payload.correct_answer = Number(document.getElementById("sg-correct").value);
  } else if (type === "true_false"){
    payload.option1 = "صح"; payload.option2 = "خطأ";
    payload.correct_answer = Number(document.querySelector('input[name="sg-tf"]:checked').value);
  } else if (type === "matching"){
    const rows = Array.from(document.querySelectorAll("#sg-pairs-list .field-grid"));
    const pairs = rows.map(r => ({
      left: r.querySelector('[id$="-l"]').value.trim(),
      right: r.querySelector('[id$="-r"]').value.trim(),
    })).filter(p => p.left && p.right);
    if (pairs.length < 2){
      errEl.textContent = "أضف زوجين على الأقل للمطابقة";
      return;
    }
    payload.pairs = pairs;
  } else if (type === "ordering"){
    const inputs = Array.from(document.querySelectorAll("#sg-items-list input"));
    const items = inputs.map(i => i.value.trim()).filter(Boolean);
    if (items.length < 2){
      errEl.textContent = "أضف عنصرين على الأقل للترتيب";
      return;
    }
    payload.ordered_items = items;
  }

  try{
    await QV.saveQuestion(payload);
    showToast("تم إرسال اقتراحك بنجاح! سيراجعه المشرف قريبًا 💡");
    resetSuggestForm();
    guardedGoTo("screen-dashboard");
  }catch(err){
    errEl.textContent = "حدث خطأ أثناء الإرسال، حاول مرة أخرى";
    console.error(err);
  }
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

/* ---------------- boot ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  QV.init();
  if (QV.isDemoMode){
    console.info("QuizVerse يعمل في الوضع التجريبي المحلي (Demo Mode) — لربط Supabase الحقيقي عدّل js/config.js");
  }

  // نُدمج أي فئات معرفية أضافها المشرف فوق الاثنتي عشرة الأساسية *قبل* أي
  // شاشة تعرض القائمة (شبكة الفئات للاعبين، القوائم المنسدلة في لوحة
  // التحكم...)، لأن QUIZ_CATEGORIES مصفوفة مشتركة تُقرأ بشكل متزامن في عشرات
  // الأماكن — إضافتها هنا مبكرًا تجعلها تظهر تلقائيًا في كل مكان دون أي
  // تعديل آخر على بقية الكود
  try{
    const customCats = await QV.getCustomCategories();
    customCats.forEach(c => {
      if (!QUIZ_CATEGORIES.some(existing => existing.id === c.id)) QUIZ_CATEGORIES.push(c);
    });
  }catch(e){ console.warn("تعذّر تحميل الفئات الإضافية", e); }

  initTheme();
  initHeader();
  initBackButtons();
  initWelcomeEntry();
  initRegister();
  initLogin();
  initDashboardActions();
  initProfileForms();
  initCategoryControls();
  initStartQuizButton();
  initResultsActions();
  initSuggestQuestion();
  initSoundSettings();
  initRandomChallenge();
  Leaderboard.init();
  Admin.init();
  Marathon.init();

  try{
    const profile = await QV.restoreSession();
    if (profile){
      AppState.profile = profile;
      updateHeaderScore();
      await renderDashboard();
      goTo("screen-dashboard");
    }
  }catch(e){ /* لا توجد جلسة سابقة صالحة */ }
});
