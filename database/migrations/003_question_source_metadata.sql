alter table questions
  add column if not exists source_title text,
  add column if not exists topic text,
  add column if not exists chapter text;
