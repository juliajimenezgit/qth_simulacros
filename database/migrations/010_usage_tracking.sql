-- Usage per person for the admin panel: last access and minutes in the app per day.
alter table users add column if not exists last_seen_at timestamptz;

create table if not exists user_usage_days (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  minutes integer not null default 0,
  -- Demo activity (seed:demo-activity) is kept apart so it can be removed without touching real usage.
  is_demo boolean not null default false,
  primary key (user_id, day, is_demo)
);

-- Demo tests feed the admin indicators only; they have no questions and are hidden from the content views.
alter table question_sets add column if not exists is_demo boolean not null default false;
-- Requested levels and documents of each test, for the per-person analytics.
alter table question_sets add column if not exists difficulty_counts jsonb;
alter table question_sets add column if not exists document_ids uuid[];
