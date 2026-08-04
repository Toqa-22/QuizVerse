-- =========================================================
-- QuizVerse | عالم الاختبارات
-- ترقية قاعدة بيانات قائمة فعليًا لإضافة نظام "مؤقت الأسئلة حسب
-- العمر" — بدون حذف أي بيانات موجودة.
--
-- نفّذ هذا الملف مرة واحدة من SQL Editor في Supabase على مشروعك
-- الحالي. الأوامر أدناه آمنة للتنفيذ المتكرر (idempotent).
-- =========================================================

-- 1) جدول فئات المؤقت حسب العمر
create table if not exists public.quiz_timer_settings (
  id            uuid primary key default uuid_generate_v4(),
  min_age       integer not null,
  max_age       integer not null,
  time_seconds  integer not null check (time_seconds >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_quiz_timer_settings_age on public.quiz_timer_settings (min_age, max_age);

alter table public.quiz_timer_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'quiz_timer_settings' and policyname = 'quiz_timer_settings_public_read') then
    create policy "quiz_timer_settings_public_read" on public.quiz_timer_settings for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'quiz_timer_settings' and policyname = 'quiz_timer_settings_public_insert') then
    create policy "quiz_timer_settings_public_insert" on public.quiz_timer_settings for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'quiz_timer_settings' and policyname = 'quiz_timer_settings_public_update') then
    create policy "quiz_timer_settings_public_update" on public.quiz_timer_settings for update using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'quiz_timer_settings' and policyname = 'quiz_timer_settings_public_delete') then
    create policy "quiz_timer_settings_public_delete" on public.quiz_timer_settings for delete using (true);
  end if;
end $$;

-- 2) عمود وضع المؤقت في الغرف الجماعية: 'custom' (كما كان دائمًا، القيمة
--    الافتراضية فتستمر كل الغرف الحالية بالعمل دون أي تغيير) أو
--    'age_based' (كل لاعب يستخدم مؤقته الخاص وفق عمره)
alter table public.games
  add column if not exists timer_mode text not null default 'custom';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'games_timer_mode_check'
  ) then
    alter table public.games
      add constraint games_timer_mode_check
      check (timer_mode in ('custom','age_based'));
  end if;
end $$;

-- =========================================================
-- انتهى. أضف فئاتك العمرية من لوحة التحكم → ⏱️ مؤقت الأعمار،
-- أو مباشرة عبر SQL، مثال:
--
--   insert into public.quiz_timer_settings (min_age, max_age, time_seconds)
--   values (5, 7, 30), (8, 10, 25), (11, 13, 20), (14, 17, 15), (18, 99, 10);
-- =========================================================
