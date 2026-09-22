alter table calendar_event
  drop constraint calendar_event_time_shape_check;

alter table calendar_event
  add constraint calendar_event_time_shape_check check (
    status = 'CANCELLED'
    or
    (all_day = true and start_date is not null and start_at is null)
    or
    (all_day = false and start_at is not null and start_date is null)
  );
