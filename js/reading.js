/* =========================================================
   📚 نظام القراءة — مرحلة مستقلة تمامًا عن الاختبارات، بلا مؤقت وبلا أي
   أسئلة تظهر بعدها. اللاعب المسموح له (راجع لوحة تحكم المشرف) يحصل على 5
   فقرات بالترتيب في كل جلسة، مع تقدّم محفوظ بشكل مستقل لكل لاعب، والتفاف
   تلقائي لبداية القائمة بعد إكمال كل الفقرات مرة واحدة على الأقل — بلا أي
   تكرار قبل ذلك.
   ========================================================= */

const Reading = (function(){
  let currentBatch = [];
  let currentIndex = 0;
  let pendingNextIndex = 0;

  function init(){
    document.getElementById("btn-dash-reading").addEventListener("click", startReadingSession);
    document.getElementById("btn-reading-next").addEventListener("click", onNextClick);
    document.getElementById("btn-reading-exit").addEventListener("click", onExitClick);
    document.getElementById("btn-reading-success-done").addEventListener("click", async () => {
      await renderDashboard();
      goTo("screen-dashboard");
    });
  }

  /* يُستدعى من renderDashboard في app.js — يُظهر زر "📚 القراءة" فقط للاعبين
     الذين منحهم المشرف صراحةً صلاحية القراءة */
  function applyDashboardVisibility(profile){
    const btn = document.getElementById("btn-dash-reading");
    if (btn) btn.hidden = !profile || !profile.reading_allowed;
  }

  async function startReadingSession(){
    const p = AppState.profile;
    if (!p || !p.reading_allowed) return;
    try{
      const { batch, nextIndex } = await QV.getNextReadingBatch(p.id);
      currentBatch = batch;
      currentIndex = 0;
      pendingNextIndex = nextIndex;
      renderCurrentPassage();
      guardedGoTo("screen-reading");
    }catch(err){
      showToast(err.message || "تعذّر بدء جلسة القراءة");
    }
  }

  function renderCurrentPassage(){
    const total = currentBatch.length;
    const passage = currentBatch[currentIndex];
    document.getElementById("reading-counter").textContent = `${currentIndex + 1} / ${total}`;
    document.getElementById("reading-progress-fill").style.width = `${((currentIndex + 1) / total) * 100}%`;
    document.getElementById("reading-title").textContent = passage.title || "";
    document.getElementById("reading-title").hidden = !passage.title;

    // انتقال بصري خفيف بين الفقرات
    const contentEl = document.getElementById("reading-content");
    contentEl.textContent = passage.content;
    contentEl.classList.remove("reading-content");
    void contentEl.offsetWidth;
    contentEl.classList.add("reading-content");

    const nextBtn = document.getElementById("btn-reading-next");
    const isLast = currentIndex === total - 1;
    nextBtn.textContent = isLast ? "✅ تم" : "التالي ←";
  }

  function onNextClick(){
    const isLast = currentIndex === currentBatch.length - 1;
    if (!isLast){
      QVSound.readingNext();
      currentIndex += 1;
      renderCurrentPassage();
      return;
    }
    finishReadingSession();
  }

  async function finishReadingSession(){
    const p = AppState.profile;
    if (!p) return;
    try{
      const beforeUnlocked = new Set(READING_ACHIEVEMENTS.filter(a => a.check(p)).map(a => a.id));

      const updated = await QV.completeReadingSession(p.id, currentBatch.length, pendingNextIndex);
      AppState.profile = updated;
      updateHeaderScore();
      QVSound.readingComplete();
      fireConfettiBurst(18); // Confetti خفيف — أقل كثافة من احتفال إنهاء اختبار كامل

      document.getElementById("reading-success-total").textContent = updated.reading_total_completed || 0;
      document.getElementById("reading-success-streak").textContent = updated.reading_streak_current || 0;
      renderCalendarInto("reading-calendar-row", updated.reading_dates || []);

      const afterUnlocked = READING_ACHIEVEMENTS.filter(a => a.check(updated));
      const newlyUnlocked = afterUnlocked.filter(a => !beforeUnlocked.has(a.id));
      const banner = document.getElementById("reading-unlock-banner");
      if (newlyUnlocked.length){
        const first = newlyUnlocked[0];
        document.getElementById("reading-unlock-icon").textContent = first.icon;
        document.getElementById("reading-unlock-text").textContent =
          newlyUnlocked.length === 1 ? `إنجاز جديد: ${first.name}` : `${newlyUnlocked.length} إنجازات قراءة جديدة! 🎉`;
        banner.hidden = false;
        setTimeout(() => QVSound.achievement(), 350);
      } else {
        banner.hidden = true;
      }

      goTo("screen-reading-success");
    }catch(err){
      showToast(err.message || "تعذّر حفظ تقدّم القراءة");
    }
  }

  function onExitClick(){
    // مغادرة قبل الضغط على "تم" لا تُسجّل أي تقدّم (المؤشر لا يتحرّك إلا بعد
    // إكمال الدفعة كاملة) — رجوع بسيط بلا أي تأثير على تقدّم اللاعب
    guardedGoTo("screen-dashboard");
  }

  /* ---------------- 📅 تقويم القراءة (آخر 7 أيام) ---------------- */
  function renderCalendarInto(containerId, dates){
    const el = document.getElementById(containerId);
    if (!el) return;
    const set = new Set(dates || []);
    const dayLabels = ["ح", "ن", "ث", "ر", "خ", "ج", "س"]; // الأحد..السبت
    const today = new Date();
    let html = "";
    for (let i = 6; i >= 0; i--){
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const read = set.has(key);
      html += `
        <div class="reading-cal-day${i === 0 ? " is-today" : ""}">
          <span class="reading-cal-day-label">${dayLabels[d.getDay()]}</span>
          <span class="reading-cal-day-dot${read ? " read" : ""}">${read ? "✓" : "·"}</span>
        </div>
      `;
    }
    el.innerHTML = html;
  }

  /* ---------------- 🏅 شبكة إنجازات القراءة (بلا أي نقاط) ---------------- */
  function renderAchievementsInto(containerId, profile){
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = READING_ACHIEVEMENTS.map(a => {
      const unlocked = a.check(profile);
      return `
        <div class="achv-badge ${unlocked ? "unlocked" : "locked"}">
          <span class="achv-icon">${unlocked ? a.icon : "🔒"}</span>
          <span class="achv-name">${escapeHtmlLocal(a.name)}</span>
          <p class="achv-desc">${escapeHtmlLocal(a.desc)}</p>
        </div>
      `;
    }).join("");
  }

  /* يُستدعى من renderProfile في app.js لعرض إحصائيات وتقويم وإنجازات
     القراءة على صفحة الملف الشخصي — تظهر بيانات فارغة بأمان للاعبين الذين
     لم يُمنحوا صلاحية القراءة أو لم يقرؤوا شيئًا بعد */
  function renderProfileSection(profile){
    const statsEl = document.getElementById("reading-profile-stats");
    if (statsEl){
      statsEl.innerHTML = `
        <div class="stat-card"><strong>${profile.reading_total_completed || 0}</strong><span>📚 فقرات مقروءة</span></div>
        <div class="stat-card"><strong>${profile.reading_streak_current || 0}</strong><span>🔥 استمرارية حالية</span></div>
        <div class="stat-card"><strong>${profile.reading_streak_best || 0}</strong><span>⭐ أفضل استمرارية</span></div>
        <div class="stat-card"><strong>${(profile.reading_dates || []).length}</strong><span>📅 أيام قراءة</span></div>
      `;
    }
    renderCalendarInto("reading-profile-calendar", profile.reading_dates || []);
    renderAchievementsInto("reading-profile-achievements", profile);
  }

  async function renderLeaderboard(){
    const list = document.getElementById("rdlb-list");
    list.innerHTML = `<li class="lb-empty">جارٍ التحميل...</li>`;
    const rows = await QV.getReadingLeaderboard();
    if (!rows.length){
      list.innerHTML = `<li class="lb-empty">لا توجد أي فقرات مقروءة بعد — كن أول قارئ! 📚</li>`;
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
        </span>
        <span class="lb-score">${r.reading_total_completed || 0}<span class="lb-score-label">فقرة</span></span>
      `;
      list.appendChild(li);
    });
  }

  function escapeHtmlLocal(str){
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  return { init, applyDashboardVisibility, renderLeaderboard, renderProfileSection };
})();
