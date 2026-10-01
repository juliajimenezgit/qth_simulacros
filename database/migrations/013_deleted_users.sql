-- Remove accounts from the team and deny access without cascading into academy content.
alter table users add column if not exists deleted_at timestamptz;
