/* =========================================================
   إعدادات الاتصال بـ Supabase
   ضع بيانات مشروعك هنا (Project Settings → API في لوحة Supabase)
   إذا تُركت القيم الافتراضية، يعمل التطبيق تلقائيًا في
   "وضع تجريبي محلي" (Demo Mode) بأسئلة وبيانات نموذجية
   دون الحاجة لأي اتصال بالإنترنت.
   ========================================================= */

const QUIZVERSE_CONFIG = {
  SUPABASE_URL: "https://wvvdtghsirbtpvmagvbr.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2dmR0Z2hzaXJidHB2bWFndmJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3ODI2OTMsImV4cCI6MjEwMTM1ODY5M30.MtVZbZ1jLPh9g2A8s8FsEw1N4UJgaB8zXfKKLeQzmMw",

  // ملاحظة: لا توجد هنا أي بيانات دخول للمشرف — حساب المشرف محفوظ بشكل
  // آمن في قاعدة البيانات (جدول admin_accounts محمي بالكامل، راجع
  // sql/schema.sql)، وليس كنص مكشوف في كود الموقع العام. أول شخص يسجّل
  // الدخول من شاشة "دخول المشرف" بأي اسم مستخدم وكلمة مرور يختارهما
  // يصبح تلقائيًا هو المشرف الوحيد لهذا الموقع.

  DEFAULT_QUESTIONS_PER_QUIZ: 10,
  DEFAULT_TIME_PER_QUESTION: 15, // بالثواني
};

/* قائمة الصور الرمزية (Avatars) المتاحة عند إنشاء الحساب */
const QUIZVERSE_AVATARS = ["🦁","🐯","🦊","🐵","🐼","🐨","🦄","🐸","🐺","🦉","🐲","🚀"];

/* كتالوج الإنجازات (Achievements) — كل عنصر فيه شرط الفتح check(profile, rank) */
const QUIZVERSE_ACHIEVEMENTS = [
  { id: "first_quiz",  name: "أول اختبار",     icon: "🏅", desc: "أكمل أول اختبار لك",              check: (p) => (p.games_played || 0) >= 1 },
  { id: "streak5",     name: "سلسلة النار",     icon: "🔥", desc: "العب 5 أيام متتالية",              check: (p) => (p.streak || 0) >= 5 },
  { id: "correct100",  name: "عقل نيّر",        icon: "🧠", desc: "اجمع 100 إجابة صحيحة",             check: (p) => (p.correct_answers || 0) >= 100 },
  { id: "top10",       name: "من الأفضل",       icon: "👑", desc: "كن ضمن أفضل 10 لاعبين",            check: (p, rank) => rank != null && rank <= 10 },
  { id: "score500",    name: "نجم صاعد",        icon: "⭐", desc: "اجمع 500 نقطة أو أكثر",            check: (p) => (p.total_score || 0) >= 500 },
  { id: "games10",     name: "لاعب مثابر",      icon: "🎮", desc: "أكمل 10 اختبارات",                 check: (p) => (p.games_played || 0) >= 10 },
  // 🎲 إنجازات وضع "التحدي العشوائي"
  { id: "rc_first",    name: "أول تحدٍ عشوائي", icon: "🎲", desc: "أكمل أول تحدٍ عشوائي لك",          check: (p) => (p.random_challenges_played || 0) >= 1 },
  { id: "rc_lucky",    name: "محظوظ",           icon: "🍀", desc: "أكمل تحديًا عشوائيًا بإجابات كاملة صحيحة", check: (p) => (p.random_challenge_perfect_count || 0) >= 1 },
  { id: "rc_master",   name: "سيد العشوائي",     icon: "🎯", desc: "اربح 10 تحديات عشوائية (نصف الأسئلة صحيحة فأكثر)", check: (p) => (p.random_challenges_won || 0) >= 10 },
  { id: "rc_100",      name: "مدمن التحدي",      icon: "💯", desc: "أكمل 100 تحدٍ عشوائي",             check: (p) => (p.random_challenges_played || 0) >= 100 },
  // 🏁 إنجازات وضع "الماراثون"
  { id: "mar_first",   name: "أول ماراثون",      icon: "🏁", desc: "أكمل أول ماراثون تشارك فيه",       check: (p) => (p.marathons_joined || 0) >= 1 },
  { id: "mar_survivor", name: "الناجي",          icon: "🔥", desc: "اصمد 25 سؤالاً متتاليًا في ماراثون واحد", check: (p) => (p.marathon_highest_streak || 0) >= 25 },
  { id: "mar_champion", name: "بطل الماراثون",    icon: "👑", desc: "اربح المركز الأول في ماراثون",     check: (p) => (p.marathon_best_rank || 0) === 1 },
  { id: "mar_legend",  name: "أسطورة الماراثون", icon: "🏆", desc: "اربح 10 ماراثونات",                check: (p) => (p.marathon_wins || 0) >= 10 },
];

/* =========================================================
   📚 إنجازات القراءة — مستقلة تمامًا عن QUIZVERSE_ACHIEVEMENTS، ولا تمنح أي
   نقاط أو مكافآت إطلاقًا؛ مجرّد شارات تقديرية لمتابعة عادة القراءة نفسها.
   ========================================================= */
const READING_ACHIEVEMENTS = [
  { id: "read_first",    name: "أول جلسة قراءة",  icon: "📖", desc: "أكمل أول جلسة قراءة لك (5 فقرات)",         check: (p) => (p.reading_total_completed || 0) >= 5 },
  { id: "read_10",       name: "بداية جميلة",      icon: "🌱", desc: "أكمل قراءة 10 فقرات",                      check: (p) => (p.reading_total_completed || 0) >= 10 },
  { id: "read_50",       name: "50 فقرة",          icon: "📚", desc: "أكمل قراءة 50 فقرة",                       check: (p) => (p.reading_total_completed || 0) >= 50 },
  { id: "read_100",      name: "100 فقرة",         icon: "🧠", desc: "أكمل قراءة 100 فقرة",                      check: (p) => (p.reading_total_completed || 0) >= 100 },
  { id: "read_200",      name: "Reading Master",   icon: "👑", desc: "أكمل قراءة 200 فقرة",                      check: (p) => (p.reading_total_completed || 0) >= 200 },
  { id: "read_streak3",  name: "استمرارية",        icon: "⚡", desc: "اقرأ 3 أيام متتالية",                      check: (p) => (p.reading_streak_best || 0) >= 3 },
  { id: "read_streak7",  name: "أسبوع كامل",       icon: "🔥", desc: "اقرأ 7 أيام متتالية",                      check: (p) => (p.reading_streak_best || 0) >= 7 },
  { id: "read_streak14", name: "مثابر",            icon: "💪", desc: "اقرأ 14 يومًا متتاليًا",                   check: (p) => (p.reading_streak_best || 0) >= 14 },
  { id: "read_30days",   name: "30 يوم قراءة",     icon: "🌟", desc: "اقرأ في 30 يومًا مختلفًا (ليست بالضرورة متتالية)", check: (p) => (p.reading_dates || []).length >= 30 },
];
