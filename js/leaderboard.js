/* =========================================================
   لوحة المتصدرين العالمية: ترتيب كل اللاعبين حسب إجمالي النقاط،
   مع تمييز اللاعب الحالي وبطاقة "ترتيبك" إن لم يكن ضمن القائمة
   المعروضة، وتنسيق خاص لأصحاب المراكز الثلاثة الأولى.
   ========================================================= */

const Leaderboard = (function(){
  const VISIBLE_TOP = 50; // عدد اللاعبين المعروضين في القائمة الرئيسية

  function init(){
    /* لا حاجة لأي إعداد إضافي حاليًا — أُبقيت الدالة لتوافق نقاط
       الاستدعاء الأخرى في التطبيق (مثل initHeader في app.js). */
  }

  async function render(){
    const list = document.getElementById("lb-list");
    const myCard = document.getElementById("lb-my-rank-card");
    const myRow = document.getElementById("lb-my-rank-row");

    list.innerHTML = `<li class="lb-empty">جارٍ التحميل...</li>`;
    myCard.hidden = true;

    const rows = await QV.getLeaderboard();

    if (!rows.length){
      list.innerHTML = `<li class="lb-empty">لا يوجد لاعبون مسجّلون بعد — كن أول من يتصدر! 🏆</li>`;
      return;
    }

    const myId = QV.getCurrentUserId();
    const visible = rows.slice(0, VISIBLE_TOP);

    list.innerHTML = "";
    visible.forEach(r => list.appendChild(buildRow(r, r.id === myId)));

    // إن لم يكن اللاعب الحالي ضمن القائمة المعروضة، نعرض له بطاقة "ترتيبك" منفصلة
    const meInVisible = visible.some(r => r.id === myId);
    if (myId && !meInVisible){
      const meRow = rows.find(r => r.id === myId);
      if (meRow){
        myRow.innerHTML = "";
        myRow.appendChild(buildRow(meRow, true));
        myCard.hidden = false;
      }
    }
  }

  function medalFor(rank){
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return null;
  }

  /* ---------------- 🎲 لوحة التحدي العشوائي (منفصلة، أفضل نتيجة لكل لاعب) ---------------- */
  async function renderRandomChallenge(){
    const list = document.getElementById("rlb-list");
    list.innerHTML = `<li class="lb-empty">جارٍ التحميل...</li>`;

    const rows = await QV.getRandomChallengeLeaderboard();
    if (!rows.length){
      list.innerHTML = `<li class="lb-empty">لا توجد تحديات عشوائية مكتملة بعد — كن أول من يجرّبها! 🎲</li>`;
      return;
    }

    const myId = QV.getCurrentUserId();
    const visible = rows.slice(0, VISIBLE_TOP);
    list.innerHTML = "";
    visible.forEach(r => list.appendChild(buildRandomRow(r, r.id === myId)));
  }

  function buildRandomRow(r, isMe){
    const li = document.createElement("li");
    const medal = medalFor(r.rank);
    li.className = "lb-row" + (r.rank <= 3 ? " top-3 rank-" + r.rank : "") + (isMe ? " is-me" : "");
    const bestTime = r.random_challenge_best_avg_time != null ? `${r.random_challenge_best_avg_time}s` : "—";
    li.innerHTML = `
      <span class="lb-rank">${medal ? `<span class="lb-medal">${medal}</span>` : r.rank}</span>
      <span class="lb-avatar">${r.avatar || (r.username || "?").charAt(0).toUpperCase()}</span>
      <span class="lb-info">
        <strong>${escapeHtml(r.username || "لاعب")}${isMe ? ' <span class="lb-you-tag">أنت</span>' : ""}</strong>
        <span class="lb-substats">⏱️ أفضل وقت: ${bestTime} · 🎲 ${r.random_challenges_played || 0} تحدٍ مكتمل</span>
      </span>
      <span class="lb-score">${r.random_challenge_best_score || 0}<span class="lb-score-label">نقطة</span></span>
    `;
    return li;
  }

  function buildRow(r, isMe){
    const li = document.createElement("li");
    const medal = medalFor(r.rank);
    li.className = "lb-row" + (r.rank <= 3 ? " top-3 rank-" + r.rank : "") + (isMe ? " is-me" : "");

    li.innerHTML = `
      <span class="lb-rank">${medal ? `<span class="lb-medal">${medal}</span>` : r.rank}</span>
      <span class="lb-avatar">${r.avatar || (r.username || "?").charAt(0).toUpperCase()}</span>
      <span class="lb-info">
        <strong>${escapeHtml(r.username || "لاعب")}${isMe ? ' <span class="lb-you-tag">أنت</span>' : ""}</strong>
        <span class="lb-substats">🎮 ${r.games_played || 0} اختبار · ✅ ${r.correct_answers || 0} إجابة صحيحة</span>
      </span>
      <span class="lb-score">${r.total_score || 0}<span class="lb-score-label">نقطة</span></span>
    `;
    return li;
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  return { init, render, renderRandomChallenge };
})();
