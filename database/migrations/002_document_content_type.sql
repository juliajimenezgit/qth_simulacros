do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_content_type') then
    create type document_content_type as enum ('MANUAL', 'TEMA', 'CAPITULO');
  end if;
end $$;

alter table documents
  add column if not exists content_type document_content_type not null default 'MANUAL';
