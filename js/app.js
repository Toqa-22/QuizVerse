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
  document.getElementById("btn-dash-profile").addEventListener("click", async () => {
    await renderProfile();
    guardedGoTo("screen-profile");
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

  renderAchievements("profile-achievements", p, rank);
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
function updateModeVisibility(){
  const isGroup = AppState.selectedMode === "multiplayer";
  document.getElementById("level-category-head").hidden = isGroup;
  document.getElementById("difficulty-card").hidden = isGroup;
  document.getElementById("category-head").hidden = isGroup;
  document.getElementById("category-grid").hidden = isGroup;
  document.getElementById("btn-start-quiz-label").textContent = isGroup ? "تصفّح الغرف الجماعية" : "ابدأ الاختبار";
}

function updateStartQuizButtonState(){
  const btn = document.getElementById("btn-start-quiz");
  const hint = document.getElementById("start-quiz-hint");
  if (!btn) return;

  updateModeVisibility();

  // في نمط الجماعي: لا حاجة لاختيار فئة أو مستوى، الزر يأخذك مباشرة لتصفح الغرف
  if (AppState.selectedMode === "multiplayer"){
    btn.disabled = false;
    hint.textContent = "اضغط للانتقال إلى الغرف الجماعية المتاحة";
    return;
  }

  if (!AppState.selectedCategory){
    btn.disabled = true;
    hint.textContent = "اختر فئة لتفعيل زر البدء";
    return;
  }
  if (AppState.profile){
    const allowed = QV.canPlay(AppState.profile, AppState.selectedCategory, AppState.selectedDifficulty);
    if (!allowed){
      btn.disabled = true;
      hint.textContent = "لقد لعبت هذه الفئة بهذا المستوى من قبل — تواصل مع المشرف لمنحك محاولة إضافية.";
      return;
    }
  }
  btn.disabled = false;
  hint.textContent = "جاهز؟ اضغط ابدأ الاختبار 🚀";
}

function initStartQuizButton(){
  document.getElementById("btn-start-quiz").addEventListener("click", () => {
    QVSound.click();
    if (AppState.selectedMode === "multiplayer"){
      const p = AppState.profile;
      Multiplayer.renderList({ name: p.username, age: p.age, avatar: p.avatar, userId: p.id });
      guardedGoTo("screen-mp-list");
      return;
    }
    if (!AppState.selectedCategory) return;
    if (!QV.canPlay(AppState.profile, AppState.selectedCategory, AppState.selectedDifficulty)){
      showToast("لقد لعبت هذه الفئة بهذا المستوى من قبل — تواصل مع المشرف لمنحك محاولة إضافية.");
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

  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      AppState.selectedMode = btn.dataset.mode;
      QVSound.click();
      updateStartQuizButtonState();
    });
  });
}

/* ---------------- quiz flow ---------------- */
async function startSoloQuiz(){
  goTo("screen-quiz");
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
    onFinish: (result) => window.onQuizFinished(result, false),
  });
  if (!ok) { renderCategories(); goTo("screen-categories"); }
}

window.onQuizFinished = async function(result, isMultiplayer, gameId){
  // اللعب المباشر: مكافأة سرعة بسيطة تُضاف لنقاط الاختبار الجماعي بحسب
  // متوسط زمن الإجابة (كلما كان اللاعب أسرع زادت المكافأة) — لا تُطبَّق على
  // الاختبارات الفردية حتى لا يتغيّر نظام نقاطها الحالي إطلاقًا
  if (isMultiplayer && gameId && result.correctCount > 0){
    const speedBonus = Math.max(0, Math.round((12 - result.avgTime) * 2));
    if (speedBonus > 0) result.score += speedBonus;
  }

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

  try{
    const { profile, newlyUnlocked } = await QV.submitQuizResult({
      userId: AppState.profile.id, result, gameId,
    });
    AppState.profile = profile;
    updateHeaderScore();
    updateStartQuizButtonState();
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
      if (names.length) setTimeout(() => showToast("إنجاز جديد مفتوح: " + names.join("، ") + " 🏅"), 1200);
    }
  }catch(e){ console.warn("تعذّر حفظ النتيجة", e); }
};

function initResultsActions(){
  document.getElementById("btn-retry").addEventListener("click", () => {
    if (!QV.canPlay(AppState.profile, AppState.selectedCategory, AppState.selectedDifficulty)){
      showToast("لقد استخدمت محاولتك لهذه الفئة والمستوى — تواصل مع المشرف لمحاولة إضافية.");
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
}

/* ---------------- back buttons ---------------- */
function initBackButtons(){
  document.querySelectorAll("[data-back]").forEach(btn => {
    btn.addEventListener("click", () => guardedGoTo(btn.dataset.back));
  });
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
  Leaderboard.init();
  Admin.init();

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
