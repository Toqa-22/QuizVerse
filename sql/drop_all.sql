-- =========================================================
-- QuizVerse | عالم الاختبارات
-- سكربت حذف قاعدة البيانات بالكامل (Teardown)
-- ينفّذ هذا الملف من SQL Editor في Supabase لحذف كل الجداول
-- والدوال والسياسات المرتبطة بمشروع QuizVerse قبل إعادة التنفيذ
-- من جديد عبر schema.sql
--
-- تحذير: هذا الإجراء لا يمكن التراجع عنه ويحذف كل البيانات
-- (حسابات اللاعبين، الأسئلة، النتائج، الغرف...) نهائيًا.
-- =========================================================

-- إسقاط الدوال (RPC) أولاً
drop function if exists public.register_player(text, text);
drop function if exists public.verify_login(text, text);
drop function if exists public.set_player_password(uuid, text);
drop function if exists public.has_any_admin();
drop function if exists public.bootstrap_admin(text, text);
drop function if exists public.verify_admin_login(text, text);
drop function if exists public.set_admin_password(text, text, text);

-- إسقاط الجداول (CASCADE يحذف تلقائيًا أي مفاتيح أجنبية/سياسات RLS مرتبطة)
drop table if exists public.answers          cascade;
drop table if exists public.game_players     cascade;
drop table if exists public.quiz_timer_settings cascade;
drop table if exists public.games            cascade;
drop table if exists public.questions        cascade;
drop table if exists public.app_settings     cascade;
drop table if exists public.achievements     cascade;
drop table if exists public.game_history     cascade;
drop table if exists public.profiles         cascade;
drop table if exists public.admin_accounts   cascade;
drop table if exists public.player_accounts  cascade;

-- =========================================================
-- بعد تنفيذ هذا الملف، نفّذ sql/schema.sql كاملاً من جديد
-- لإعادة إنشاء قاعدة البيانات من الصفر.
-- =========================================================
