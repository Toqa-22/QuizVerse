-- =========================================================
-- QuizVerse | عالم الاختبارات
-- ترقية قاعدة بيانات قائمة فعليًا لدعم أنواع أسئلة جديدة:
-- صح/خطأ، مطابقة، وترتيب — بدون حذف أي بيانات موجودة.
--
-- نفّذ هذا الملف مرة واحدة من SQL Editor في Supabase على مشروعك
-- الحالي (لا حاجة لتنفيذ schema.sql من جديد ولا لحذف أي شيء).
-- الأوامر أدناه آمنة للتنفيذ المتكرر (idempotent).
-- =========================================================

-- 1) إضافة عمود "type" لتمييز نوع السؤال — كل الأسئلة الحالية تُعامَل
--    تلقائيًا كأسئلة "اختيار من متعدد" (القيمة الافتراضية)، فتستمر
--    بالعمل دون أي تغيير.
alter table public.questions
  add column if not exists type text not null default 'multiple_choice';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'questions_type_check'
  ) then
    alter table public.questions
      add constraint questions_type_check
      check (type in ('multiple_choice','true_false','matching','ordering'));
  end if;
end $$;

-- 2) أعمدة أسئلة المطابقة والترتيب الجديدة
alter table public.questions add column if not exists pairs jsonb;
alter table public.questions add column if not exists ordered_items jsonb;

-- 3) جعل حقول الاختيار من متعدد اختيارية (nullable) — أسئلة الصح/الخطأ
--    والمطابقة والترتيب لا تحتاجها. الأسئلة الحالية تبقى كما هي تمامًا.
alter table public.questions alter column option1 drop not null;
alter table public.questions alter column option2 drop not null;
alter table public.questions alter column option3 drop not null;
alter table public.questions alter column option4 drop not null;
alter table public.questions alter column correct_answer drop not null;

-- 4) تحديث قيد correct_answer ليسمح بـ NULL (لأسئلة المطابقة/الترتيب)
--    مع بقاء التحقق من النطاق 1-4 لبقية الأنواع كما كان تمامًا
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'questions_correct_answer_check'
  ) then
    alter table public.questions drop constraint questions_correct_answer_check;
  end if;
  alter table public.questions
    add constraint questions_correct_answer_check
    check (correct_answer is null or correct_answer between 1 and 4);
end $$;

-- 5) فهرس على النوع لتسريع فلترة الأسئلة حسب نوعها
create index if not exists idx_questions_type on public.questions (type);

-- =========================================================
-- انتهى. لا حاجة لأي إجراء إضافي — التطبيق (بعد تحديث ملفات
-- js/*.js و index.html) سيتعرف تلقائيًا على الأسئلة الجديدة بمجرد
-- إضافتها من لوحة التحكم واختيار النوع المناسب.
-- =========================================================
