-- Page printed in the manual; chapter PDFs start mid-manual, so it differs from the PDF page.
alter table document_chunks
  add column if not exists manual_page integer;
