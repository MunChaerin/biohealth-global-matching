create table if not exists public.chat_sessions (session_id text primary key, patient_id text not null, context jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.camera_reports (patient_id text primary key, report jsonb not null, measured_at timestamptz not null, received_at timestamptz not null default now());
create table if not exists public.motion_reports (patient_id text primary key, report jsonb not null, measured_at timestamptz not null, updated_at timestamptz not null default now());
create table if not exists public.care_calls (patient_id text primary key, session_id text not null, status text not null check (status in ('requested', 'acknowledged')), requested_at timestamptz not null, acknowledged_at timestamptz);
create table if not exists public.care_explanations (session_id text primary key, text text not null, language text not null check (language in ('ko', 'ja')), updated_at timestamptz not null default now());
create table if not exists public.medication_intakes (patient_id text not null, intake_date date not null, medication_id text not null, record jsonb not null, updated_at timestamptz not null default now(), primary key (patient_id, intake_date, medication_id));
create table if not exists public.medication_reminders (patient_id text not null, medication_time text not null, open_at text not null, updated_at timestamptz not null default now(), primary key (patient_id, medication_time), constraint medication_time_format check (medication_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'), constraint open_at_format check (open_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));

alter table public.chat_sessions enable row level security;
alter table public.camera_reports enable row level security;
alter table public.motion_reports enable row level security;
alter table public.care_calls enable row level security;
alter table public.care_explanations enable row level security;
alter table public.medication_intakes enable row level security;
alter table public.medication_reminders enable row level security;

revoke all on public.chat_sessions, public.camera_reports, public.motion_reports, public.care_calls, public.care_explanations, public.medication_intakes, public.medication_reminders from anon, authenticated;
grant all on public.chat_sessions, public.camera_reports, public.motion_reports, public.care_calls, public.care_explanations, public.medication_intakes, public.medication_reminders to service_role;

create or replace function public.save_camera_report_if_newer(
  p_patient_id text,
  p_report jsonb,
  p_measured_at timestamptz,
  p_received_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_rows integer;
begin
  insert into public.camera_reports (patient_id, report, measured_at, received_at)
  values (p_patient_id, p_report, p_measured_at, p_received_at)
  on conflict (patient_id) do update
  set report = excluded.report,
      measured_at = excluded.measured_at,
      received_at = excluded.received_at
  where excluded.measured_at >= public.camera_reports.measured_at;
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create or replace function public.save_motion_report_if_newer(
  p_patient_id text,
  p_report jsonb,
  p_measured_at timestamptz,
  p_updated_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_rows integer;
begin
  insert into public.motion_reports (patient_id, report, measured_at, updated_at)
  values (p_patient_id, p_report, p_measured_at, p_updated_at)
  on conflict (patient_id) do update
  set report = excluded.report,
      measured_at = excluded.measured_at,
      updated_at = excluded.updated_at
  where excluded.measured_at >= public.motion_reports.measured_at;
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create or replace function public.record_medication_taken(
  p_patient_id text,
  p_intake_date date,
  p_medication_id text,
  p_taken_at timestamptz,
  p_method text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.medication_intakes (patient_id, intake_date, medication_id, record, updated_at)
  values (
    p_patient_id,
    p_intake_date,
    p_medication_id,
    jsonb_build_object('mismatchCount', 0, 'takenAt', p_taken_at, 'method', p_method),
    now()
  )
  on conflict (patient_id, intake_date, medication_id) do update
  set record = public.medication_intakes.record || jsonb_build_object(
        'takenAt', coalesce(public.medication_intakes.record -> 'takenAt', to_jsonb(p_taken_at)),
        'method', coalesce(public.medication_intakes.record -> 'method', to_jsonb(p_method))
      ),
      updated_at = now();
$$;

create or replace function public.record_medication_recognition(
  p_patient_id text,
  p_intake_date date,
  p_medication_id text,
  p_result jsonb,
  p_is_mismatch boolean,
  p_detected_drug_code text,
  p_measured_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base_record jsonb;
begin
  base_record := jsonb_build_object('mismatchCount', case when p_is_mismatch then 1 else 0 end, 'lastRecognition', p_result);
  if p_is_mismatch then
    base_record := base_record || jsonb_build_object('lastMismatch', jsonb_build_object('detectedDrugCode', p_detected_drug_code, 'at', p_measured_at));
  end if;

  insert into public.medication_intakes (patient_id, intake_date, medication_id, record, updated_at)
  values (p_patient_id, p_intake_date, p_medication_id, base_record, now())
  on conflict (patient_id, intake_date, medication_id) do update
  set record = public.medication_intakes.record
      || jsonb_build_object('lastRecognition', p_result)
      || case when p_is_mismatch then jsonb_build_object(
           'mismatchCount', coalesce((public.medication_intakes.record ->> 'mismatchCount')::integer, 0) + 1,
           'lastMismatch', jsonb_build_object('detectedDrugCode', p_detected_drug_code, 'at', p_measured_at)
         ) else '{}'::jsonb end,
      updated_at = now();
end;
$$;

revoke all on function public.save_camera_report_if_newer(text, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.save_motion_report_if_newer(text, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.record_medication_taken(text, date, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.record_medication_recognition(text, date, text, jsonb, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_camera_report_if_newer(text, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.save_motion_report_if_newer(text, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.record_medication_taken(text, date, text, timestamptz, text) to service_role;
grant execute on function public.record_medication_recognition(text, date, text, jsonb, boolean, text, timestamptz) to service_role;
