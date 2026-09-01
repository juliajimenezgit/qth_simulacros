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

create index if not exists quality_instructions_active_idx
  on quality_instructions(active);

create index if not exists quality_instructions_embedding_idx
  on quality_instructions using hnsw (embedding vector_cosine_ops);
