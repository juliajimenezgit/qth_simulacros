create extension if not exists vector;
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('ADMIN', 'PROFESOR');
  end if;

  if not exists (select 1 from pg_type where typname = 'document_status') then
    create type document_status as enum ('PROCESSING', 'AVAILABLE', 'ERROR');
  end if;

  if not exists (select 1 from pg_type where typname = 'document_content_type') then
    create type document_content_type as enum ('MANUAL', 'TEMA', 'CAPITULO');
  end if;

  if not exists (select 1 from pg_type where typname = 'question_difficulty') then
    create type question_difficulty as enum ('PRINCIPIANTE', 'ELITE', 'ALEATORIO');
  end if;
end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role user_role not null default 'PROFESOR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  filename text not null,
  original_filename text not null,
  storage_path text not null,
  content_type document_content_type not null default 'MANUAL',
  status document_status not null default 'PROCESSING',
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  text text not null,
  page integer,
  section text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  source_chunk_id uuid references document_chunks(id) on delete set null,
  question text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer char(1) not null check (correct_answer in ('A', 'B', 'C', 'D')),
  explanation text not null,
  reference text not null,
  difficulty question_difficulty not null,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quality_instructions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  difficulty question_difficulty,
  active boolean not null default true,
  embedding vector(1536),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists documents_user_id_idx on documents(user_id);
create index if not exists document_chunks_document_id_idx on document_chunks(document_id);
create index if not exists questions_user_id_idx on questions(user_id);
create index if not exists questions_document_id_idx on questions(document_id);
create index if not exists quality_instructions_active_idx on quality_instructions(active);
create index if not exists activity_logs_created_at_idx on activity_logs(created_at desc);

create index if not exists document_chunks_embedding_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists questions_embedding_idx
  on questions using hnsw (embedding vector_cosine_ops);

create index if not exists quality_instructions_embedding_idx
  on quality_instructions using hnsw (embedding vector_cosine_ops);
