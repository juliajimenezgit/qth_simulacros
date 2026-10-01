-- The app shows three test levels: Principiante (only P questions), Élite (F and D) and Aleatorio
-- (P, F and D). The old presets were Principiante (P and F), Fácil (F and D) and Difícil (P, F and D).
alter table question_sets drop constraint if exists question_sets_test_difficulty_check;

update question_sets set test_difficulty = 'ELITE' where test_difficulty = 'FACIL';
update question_sets set test_difficulty = 'ALEATORIO' where test_difficulty = 'DIFICIL';
-- An old Principiante test with F or D questions no longer fits Principiante.
update question_sets set test_difficulty = 'CUSTOM'
where test_difficulty = 'PRINCIPIANTE'
  and (coalesce((difficulty_counts->>'F')::int, 0) > 0 or coalesce((difficulty_counts->>'D')::int, 0) > 0);

alter table question_sets add constraint question_sets_test_difficulty_check
  check (test_difficulty in ('PRINCIPIANTE', 'ELITE', 'ALEATORIO', 'CUSTOM'));

-- Questions per test level as the teacher chose them (a test can combine levels): {"PRINCIPIANTE": 10, "ELITE": 10, "ALEATORIO": 10}.
alter table question_sets add column if not exists level_counts jsonb;
