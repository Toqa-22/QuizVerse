-- =========================================================
-- QuizVerse | عالم الاختبارات
-- مخطط قاعدة بيانات Supabase (PostgreSQL) + سياسات RLS
-- نفّذ هذا الملف كاملاً من SQL Editor داخل لوحة Supabase
-- =========================================================

-- تفعيل امتداد UUID
create extension if not exists "uuid-ossp";

-- =========================================================
-- 0) جدول حسابات اللاعبين (اسم مستخدم + كلمة مرور فقط — بلا بريد إلكتروني،
-- وبلا أي اعتماد على Supabase Auth). هذا الجدول محمي بالكامل: لا توجد له
-- أي سياسة SELECT/UPDATE للعميل مباشرة — يُقرأ ويُكتب فقط عبر دوال RPC
-- الآمنة (security definer) بالأسفل، حتى لا تتسرب كلمات المرور المشفّرة
-- أبدًا لأي طرف عبر واجهة القراءة العامة.
-- =========================================================
create table if not exists public.player_accounts (
  id            uuid primary key default uuid_generate_v4(),
  username      text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

alter table public.player_accounts enable row level security;
-- عمدًا: لا سياسات SELECT/UPDATE/DELETE هنا — الوصول فقط عبر الدوال أدناه.

create or replace function public.register_player(p_username text, p_password_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if exists (select 1 from public.player_accounts where username = p_username) then
    raise exception 'اسم المستخدم مستخدم بالفعل';
  end if;
  insert into public.player_accounts (username, password_hash)
  values (p_username, p_password_hash)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.verify_login(p_username text, p_password_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
begin
  select id into found_id from public.player_accounts
  where username = p_username and password_hash = p_password_hash;
  return found_id; -- NULL إن لم تتطابق البيانات
end;
$$;

create or replace function public.set_player_password(p_id uuid, p_new_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.player_accounts set password_hash = p_new_hash where id = p_id;
$$;

-- السماح لأي زائر (anon) وأي مستخدم بتنفيذ هذه الدوال فقط (وليس قراءة الجدول مباشرة)
grant execute on function public.register_player(text, text)      to anon, authenticated;
grant execute on function public.verify_login(text, text)         to anon, authenticated;
grant execute on function public.set_player_password(uuid, text)  to anon, authenticated;

-- =========================================================
-- 0ب) جدول حساب المشرف — محمي بالكامل بنفس فلسفة player_accounts أعلاه:
-- لا كلمات مرور مكشوفة في كود JavaScript، ولا سياسات قراءة/كتابة مباشرة.
--
-- آلية "التمهيد الذاتي" (Bootstrap): الجدول يبدأ فارغًا. أول شخص يسجّل
-- الدخول من شاشة المشرف بأي اسم مستخدم وكلمة مرور يختارهما يصبح تلقائيًا
-- هو المشرف الوحيد، وتُغلق إمكانية إنشاء حساب مشرف جديد فورًا بعد ذلك.
-- هذا يمنع أي زائر آخر من إنشاء حساب مشرف لنفسه لاحقًا.
-- =========================================================
create table if not exists public.admin_accounts (
  id            uuid primary key default uuid_generate_v4(),
  username      text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

alter table public.admin_accounts enable row level security;
-- عمدًا: لا سياسات SELECT/UPDATE/DELETE هنا — الوصول فقط عبر الدوال أدناه.

create or replace function public.has_any_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_accounts);
$$;

-- ينجح فقط إن لم يوجد أي حساب مشرف مسبقًا (أول استدعاء فقط، بعدها يُرفض دائمًا)
create or replace function public.bootstrap_admin(p_username text, p_password_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.admin_accounts) then
    return false;
  end if;
  insert into public.admin_accounts (username, password_hash) values (p_username, p_password_hash);
  return true;
end;
$$;

create or replace function public.verify_admin_login(p_username text, p_password_hash text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_accounts
    where username = p_username and password_hash = p_password_hash
  );
$$;

create or replace function public.set_admin_password(p_username text, p_old_hash text, p_new_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.admin_accounts
  set password_hash = p_new_hash
  where username = p_username and password_hash = p_old_hash;
  return found;
end;
$$;

grant execute on function public.has_any_admin()                        to anon, authenticated;
grant execute on function public.bootstrap_admin(text, text)            to anon, authenticated;
grant execute on function public.verify_admin_login(text, text)         to anon, authenticated;
grant execute on function public.set_admin_password(text, text, text)   to anon, authenticated;

-- =========================================================
-- 1) جدول الملفات الشخصية العامة للاعبين (بيانات غير حساسة: النقاط،
-- المستوى، الإنجازات...) — معرّفها (id) هو نفسه معرّف الحساب في
-- player_accounts أعلاه، لكن هذا الجدول قابل للقراءة العامة (للوحة
-- المتصدرين) بخلاف player_accounts المحمي بالكامل.
-- =========================================================
create table if not exists public.profiles (
  id                uuid primary key,
  username          text not null unique,
  avatar            text not null default '🦁',
  age               text not null,               -- الفئة العمرية مثل "11-13" أو "18+"
  total_score       integer not null default 0,
  level             text not null default 'مبتدئ',
  games_played      integer not null default 0,
  correct_answers   integer not null default 0,
  streak            integer not null default 0,
  last_played_date  date,
  favorite_category text,
  achievements      text[] not null default '{}',  -- معرّفات الإنجازات المفتوحة
  completed_combos  text[] not null default '{}',  -- فئات+مستويات أُنجزت مسبقًا، مثل "science:easy"
  replay_grants     jsonb  not null default '{}'::jsonb, -- محاولات إضافية ممنوحة من المشرف لكل "فئة:مستوى"
  recent_questions  jsonb  not null default '{}'::jsonb, -- "فئة:مستوى" -> [معرّفات أسئلة أُجيب عنها مؤخرًا]
  created_at        timestamptz not null default now()
);

create index if not exists idx_profiles_score on public.profiles (total_score desc);
create index if not exists idx_profiles_username on public.profiles (username);

-- =========================================================
-- 1ب) جدول إعدادات عامة للتطبيق (key/value) — يُستخدم حاليًا
-- لتخزين عدد الأسئلة ومؤقت كل فئة ومفاتيح العشوائية
-- =========================================================
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 2) جدول الأسئلة
-- =========================================================
create table if not exists public.questions (
  id              uuid primary key default uuid_generate_v4(),
  type            text not null default 'multiple_choice'
                    check (type in ('multiple_choice','true_false','matching','ordering')),
  question        text not null,
  -- تُستخدم option1..4 و correct_answer لأسئلة الاختيار من متعدد (كالسابق تمامًا)
  -- ولأسئلة صح/خطأ (correct_answer: 1=صح، 2=خطأ، بلا حاجة للخيارات النصية).
  -- أصبحت هذه الحقول اختيارية الآن (nullable) لأن أسئلة المطابقة والترتيب لا تستخدمها.
  option1         text,
  option2         text,
  option3         text,
  option4         text,
  correct_answer  smallint check (correct_answer is null or correct_answer between 1 and 4),
  -- تُستخدم فقط لأسئلة المطابقة (type = 'matching'): مصفوفة أزواج
  -- بصيغة [{"left":"عمان","right":"مسقط"}, {"left":"اليابان","right":"طوكيو"}, ...]
  pairs           jsonb,
  -- تُستخدم فقط لأسئلة الترتيب (type = 'ordering'): القائمة بالترتيب الصحيح
  -- بصيغة ["عطارد","الزهرة","الأرض","المريخ"] — يُخلط ترتيبها تلقائيًا عند بدء الاختبار
  ordered_items   jsonb,
  category        text not null,
  age_min         integer not null default 5,
  age_max         integer not null default 99,
  difficulty      text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  points          integer not null default 10,
  explanation     text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_questions_category on public.questions (category);
create index if not exists idx_questions_age on public.questions (age_min, age_max);
create index if not exists idx_questions_difficulty on public.questions (difficulty);
create index if not exists idx_questions_type on public.questions (type);

-- =========================================================
-- 3) جدول الغرف الجماعية (لا بُد أن يُنشأ قبل أي جدول يُشير إليه
-- بمفتاح خارجي، مثل game_history وgame_players وanswers أدناه)
-- =========================================================
create table if not exists public.games (
  id                 uuid primary key default uuid_generate_v4(),
  title              text not null,
  description        text,
  category           text not null,
  min_age            integer not null default 5,
  max_age            integer not null default 99,
  question_count     integer not null default 10,
  time_per_question  integer not null default 15,
  timer_mode         text not null default 'custom' check (timer_mode in ('custom','age_based')),
  -- 'custom': يستخدم كل اللاعبين نفس قيمة time_per_question أعلاه.
  -- 'age_based': كل لاعب يستخدم مؤقته الخاص وفق عمره ومطابقته لجدول
  -- quiz_timer_settings أدناه، محسوبًا في متصفحه عند بدء الاختبار.
  max_players        integer not null default 20,
  status             text not null default 'waiting' check (status in ('waiting','started','finished')),
  start_time         timestamptz default now(),
  question_set       jsonb,  -- مجموعة الأسئلة الثابتة التي يولّدها المشرف عند الضغط على "بدء"
                              -- (نفس الأسئلة وبنفس الترتيب لكل اللاعبين، لضمان عدالة المنافسة)
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now()
);

create index if not exists idx_games_status on public.games (status);

-- =========================================================
-- 3ب) مؤقت الأسئلة حسب الفئة العمرية — يحدده المشرف ويطبَّق تلقائيًا
-- على الاختبارات الفردية بحسب عمر اللاعب المسجَّل في ملفه الشخصي.
-- له أولوية على مؤقت الفئة المعرفية (category_timers في app_settings)
-- عند وجود فئة عمرية مطابقة؛ وإلا يُستخدم مؤقت الفئة كخيار احتياطي.
-- =========================================================
create table if not exists public.quiz_timer_settings (
  id            uuid primary key default uuid_generate_v4(),
  min_age       integer not null,
  max_age       integer not null,
  time_seconds  integer not null check (time_seconds >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_quiz_timer_settings_age on public.quiz_timer_settings (min_age, max_age);

-- =========================================================
-- 3ب) جدول سجل الألعاب (نتيجة كل اختبار يلعبه المستخدم)
-- يُستخدم لحساب لوحة المتصدرين اليومية/الأسبوعية/الشهرية ولعرض
-- "آخر الاختبارات" في لوحة اللاعب
-- =========================================================
create table if not exists public.game_history (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  game_id       uuid references public.games(id),   -- فارغ إن كان الاختبار فرديًا (Solo)
  category      text not null,
  score         integer not null default 0,
  correct_count integer not null default 0,
  total         integer not null default 0,
  played_at     timestamptz not null default now()
);

create index if not exists idx_history_user on public.game_history (user_id);
create index if not exists idx_history_played_at on public.game_history (played_at desc);

-- =========================================================
-- 3ج) جدول الإنجازات المفتوحة (نسخة معيارية اختيارية؛
-- في الوضع الحالي تُخزَّن الإنجازات أيضًا كمصفوفة داخل profiles
-- لتبسيط القراءة، لكن هذا الجدول يوفر سجلاً تاريخيًا لوقت الفتح)
-- =========================================================
create table if not exists public.achievements (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  achievement_id text not null,   -- يطابق id في QUIZVERSE_ACHIEVEMENTS بـ js/config.js
  unlocked_at    timestamptz not null default now(),
  unique (user_id, achievement_id)
);

create index if not exists idx_achievements_user on public.achievements (user_id);

-- =========================================================
-- 4) جدول لاعبي الغرفة
-- =========================================================
create table if not exists public.game_players (
  id         uuid primary key default uuid_generate_v4(),
  game_id    uuid not null references public.games(id) on delete cascade,
  user_id    uuid references public.profiles(id),
  name       text not null,
  age        text,
  avatar     text,
  score      integer not null default 0,
  joined_at  timestamptz not null default now()
);

create index if not exists idx_game_players_game on public.game_players (game_id);

-- =========================================================
-- 5) جدول الإجابات (سجل تفصيلي لكل إجابة داخل غرفة جماعية)
-- =========================================================
create table if not exists public.answers (
  id           uuid primary key default uuid_generate_v4(),
  game_id      uuid not null references public.games(id) on delete cascade,
  user_id      uuid references public.profiles(id),
  question_id  uuid not null references public.questions(id),
  answer       smallint,
  correct      boolean not null default false,
  points       integer not null default 0,
  answered_at  timestamptz not null default now()
);

create index if not exists idx_answers_game on public.answers (game_id);
create index if not exists idx_answers_question on public.answers (question_id);

-- =========================================================
-- تفعيل Row Level Security على جميع الجداول
-- =========================================================
alter table public.profiles     enable row level security;
alter table public.game_history enable row level security;
alter table public.achievements enable row level security;
alter table public.app_settings enable row level security;
alter table public.questions    enable row level security;
alter table public.games        enable row level security;
alter table public.quiz_timer_settings enable row level security;
alter table public.game_players enable row level security;
alter table public.answers      enable row level security;

-- =========================================================
-- ملاحظة مهمة حول نموذج الصلاحيات:
-- بما أن هذا التطبيق لا يستخدم Supabase Auth إطلاقًا (حسابات اللاعبين
-- تُدار عبر player_accounts + دوال RPC آمنة أعلاه، وحساب المشرف قيمة
-- ثابتة في js/config.js وليس مستخدم Supabase Auth حقيقي)، فلا يوجد
-- auth.uid() فعلي يمكن الاعتماد عليه لتمييز "صاحب الصف" أو "المشرف"
-- من داخل سياسات RLS. الحماية الوحيدة الحقيقية في هذا المشروع هي على
-- جدول player_accounts (محمي بالكامل، ولا يُقرأ إلا عبر RPC كما بالأعلى).
-- بقية الجداول أدناه (النقاط، الأسئلة، الغرف...) بيانات تشغيلية غير
-- حساسة، وسياساتها هنا "سماحية" (Permissive) لتبقى الميزات تعمل من
-- جهة العميل مباشرة، تمامًا كما في الوضع التجريبي المحلي.
-- لبيئة إنتاج حقيقية بمستخدمين خارجيين لا تثق بهم: انقل عمليات الكتابة
-- الحساسة (خصوصًا لوحة تحكم المشرف: الأسئلة/الإعدادات/الغرف) خلف
-- Supabase Edge Function تتحقق من كلمة مرور المشرف قبل التنفيذ، بدل
-- استدعاء supabase-js مباشرة من المتصفح.
-- =========================================================

-- ---------- profiles ----------
create policy "profiles_public_read" on public.profiles
  for select using (true);
create policy "profiles_public_insert" on public.profiles
  for insert with check (true);
create policy "profiles_public_update" on public.profiles
  for update using (true);
create policy "profiles_public_delete" on public.profiles
  for delete using (true);

-- ---------- game_history ----------
create policy "history_public_read" on public.game_history
  for select using (true);
create policy "history_public_insert" on public.game_history
  for insert with check (true);
create policy "history_public_delete" on public.game_history
  for delete using (true);

-- ---------- achievements ----------
create policy "achievements_public_read" on public.achievements
  for select using (true);
create policy "achievements_public_insert" on public.achievements
  for insert with check (true);

-- ---------- app_settings (عدد الأسئلة لكل فئة + مفاتيح العشوائية) ----------
create policy "app_settings_public_read" on public.app_settings
  for select using (true);
create policy "app_settings_public_write" on public.app_settings
  for insert with check (true);
create policy "app_settings_public_update" on public.app_settings
  for update using (true);

-- ---------- questions ----------
create policy "questions_public_read" on public.questions
  for select using (true);
create policy "questions_public_insert" on public.questions
  for insert with check (true);
create policy "questions_public_update" on public.questions
  for update using (true);
create policy "questions_public_delete" on public.questions
  for delete using (true);

-- ---------- games ----------
create policy "games_public_read" on public.games
  for select using (true);
create policy "games_public_insert" on public.games
  for insert with check (true);
create policy "games_public_update" on public.games
  for update using (true);
create policy "games_public_delete" on public.games
  for delete using (true);

-- ---------- quiz_timer_settings ----------
create policy "quiz_timer_settings_public_read" on public.quiz_timer_settings
  for select using (true);
create policy "quiz_timer_settings_public_insert" on public.quiz_timer_settings
  for insert with check (true);
create policy "quiz_timer_settings_public_update" on public.quiz_timer_settings
  for update using (true);
create policy "quiz_timer_settings_public_delete" on public.quiz_timer_settings
  for delete using (true);

-- ---------- game_players ----------
create policy "game_players_public_read" on public.game_players
  for select using (true);
create policy "game_players_public_insert" on public.game_players
  for insert with check (true);
create policy "game_players_public_update" on public.game_players
  for update using (true);
create policy "game_players_public_delete" on public.game_players
  for delete using (true);

-- ---------- answers ----------
create policy "answers_public_read" on public.answers
  for select using (true);
create policy "answers_public_insert" on public.answers
  for insert with check (true);
create policy "answers_public_delete" on public.answers
  for delete using (true);

-- =========================================================
-- تفعيل Realtime على جداول الغرف الجماعية
-- (نفّذ هذا أيضًا من تبويب Database → Replication في Supabase
--  إذا لم يعمل الأمر أدناه مباشرة بسبب صلاحيات المشروع)
-- =========================================================
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_players;
alter publication supabase_realtime add table public.answers;

-- =========================================================
-- ملاحظات ختامية:
--
-- 1) حسابات اللاعبين: اسم مستخدم + كلمة مرور فقط، بلا أي بريد إلكتروني.
--    التسجيل عبر public.register_player(username, password_hash)،
--    الدخول عبر public.verify_login(username, password_hash) — راجع
--    أعلى الملف. لا تُستخدم Supabase Auth إطلاقًا في هذا المشروع.
--
-- 2) حساب المشرف: محفوظ في جدول admin_accounts المحمي بالكامل (بنفس
--    فلسفة player_accounts)، وليس قيمة ثابتة في كود JavaScript. يُنشأ
--    تلقائيًا بآلية "تمهيد ذاتي" — أول من يسجّل الدخول من شاشة المشرف
--    بأي اسم مستخدم وكلمة مرور يصبح هو المشرف الوحيد؛ راجع
--    public.bootstrap_admin و public.verify_admin_login أعلى الملف.
--    لبيئة إنتاج حقيقية بعدة مشرفين، وسّع الجدول ليدعم أكثر من صف
--    وأضف طبقة تحقق من جهة الخادم (Edge Function) بدل استدعاء
--    supabase-js مباشرة من المتصفح للعمليات الحساسة.
--
-- 3) دالة تشفير كلمة المرور (simpleHash في js/supabase-client.js)
--    بصمة بسيطة غير تشفيرية، كافية لأغراض العرض التجريبي والتطوير
--    فقط. لبيئة إنتاج حقيقية، استبدلها بخوارزمية تجزئة قوية (مثل
--    bcrypt أو Argon2) تُنفَّذ من جهة الخادم، وليس في متصفح العميل.
-- =========================================================
