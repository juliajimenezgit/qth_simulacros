-- Preserve the chosen test title separately from its constituent question levels.
alter table question_sets add column if not exists test_difficulty text
  check (test_difficulty in ('PRINCIPIANTE', 'FACIL', 'DIFICIL', 'CUSTOM'));
