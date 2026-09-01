create table if not exists quality_source_documents (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('OFFICIAL_EXAM', 'ANNOTATED_GUIDE', 'QUALITY_GUIDE')),
  filename text not null,
  source_path text not null unique,
  checksum text not null,
  page_count integer not null default 0,
  processed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists quality_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references quality_source_documents(id) on delete cascade,
  source_type text not null,
  text text not null,
  page integer,
  section text,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists quality_knowledge_source_idx
  on quality_knowledge_chunks(source_type);

create index if not exists quality_knowledge_embedding_idx
  on quality_knowledge_chunks using hnsw (embedding vector_cosine_ops);
