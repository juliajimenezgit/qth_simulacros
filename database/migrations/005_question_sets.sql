create table if not exists question_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  requested_count integer not null,
  generated_count integer not null default 0,
  status text not null default 'GENERATING' check (status in ('GENERATING', 'COMPLETED', 'ERROR')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table questions
  add column if not exists question_set_id uuid references question_sets(id) on delete set null;

create index if not exists questions_question_set_id_idx
  on questions(question_set_id);
