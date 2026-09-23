alter table action_execution
  add column failure_summary text,
  add column retryable boolean not null default false;
