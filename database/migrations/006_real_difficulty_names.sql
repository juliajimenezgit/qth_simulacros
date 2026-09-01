do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'question_difficulty' and e.enumlabel = 'ELITE'
  ) then
    alter type question_difficulty rename value 'ELITE' to 'FACIL';
  end if;

  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'question_difficulty' and e.enumlabel = 'ALEATORIO'
  ) then
    alter type question_difficulty rename value 'ALEATORIO' to 'DIFICIL';
  end if;
end $$;
