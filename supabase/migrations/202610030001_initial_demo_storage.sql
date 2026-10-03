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
