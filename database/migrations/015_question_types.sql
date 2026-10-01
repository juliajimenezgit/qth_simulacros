-- What each question measures (literal, conceptual, clasificación…), as the reviewer classified it.
-- Generated tests follow the teachers' mix of types for each level (server/src/utils/questionTypes.js).
alter table questions add column if not exists question_type text;
