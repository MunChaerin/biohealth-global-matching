import { assertSupabaseResult, getSupabaseAdmin, isSupabaseConfigured, requireProductionStorage } from "../supabase/server";

export type CareCallStatus = "requested" | "acknowledged";

export interface CareCall {
  patientId: string;
  sessionId: string;
  status: CareCallStatus;
  requestedAt: string;
  acknowledgedAt?: string;
}

type CareExplanation = { sessionId: string; text: string; language: "ko" | "ja"; updatedAt: string };

const root = globalThis as typeof globalThis & { __careCalls?: Map<string, CareCall>; __careExplanations?: Map<string, CareExplanation> };
const calls = root.__careCalls ??= new Map();
const explanations = root.__careExplanations ??= new Map();

export async function getCareCall(patientId: string): Promise<CareCall | null> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseAdmin().from("care_calls").select("*").eq("patient_id", patientId).maybeSingle();
    assertSupabaseResult(error);
    return data ? { patientId: data.patient_id, sessionId: data.session_id, status: data.status, requestedAt: data.requested_at, acknowledgedAt: data.acknowledged_at ?? undefined } : null;
  }
  return calls.get(patientId) ?? null;
}
export async function requestCareCall(patientId: string, sessionId: string): Promise<CareCall> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const current = await getCareCall(patientId);
    if (current?.status === "requested") return current;
    const call: CareCall = { patientId, sessionId, status: "requested", requestedAt: new Date().toISOString() };
    const { error } = await getSupabaseAdmin().from("care_calls").upsert({ patient_id: patientId, session_id: sessionId, status: call.status, requested_at: call.requestedAt, acknowledged_at: null });
    assertSupabaseResult(error);
    return call;
  }
  const current = calls.get(patientId);
  if (current?.status === "requested") return current;
  const call: CareCall = { patientId, sessionId, status: "requested", requestedAt: new Date().toISOString() };
  calls.set(patientId, call);
  return call;
}
export async function acknowledgeCareCall(patientId: string): Promise<CareCall | null> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const current = await getCareCall(patientId);
    if (!current) return null;
    const next = { ...current, status: "acknowledged" as const, acknowledgedAt: new Date().toISOString() };
    const { error } = await getSupabaseAdmin().from("care_calls").update({ status: next.status, acknowledged_at: next.acknowledgedAt }).eq("patient_id", patientId);
    assertSupabaseResult(error);
    return next;
  }
  const current = calls.get(patientId);
  if (!current) return null;
  const next = { ...current, status: "acknowledged" as const, acknowledgedAt: new Date().toISOString() };
  calls.set(patientId, next);
  return next;
}
export async function getCareExplanation(sessionId: string): Promise<CareExplanation | null> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseAdmin().from("care_explanations").select("*").eq("session_id", sessionId).maybeSingle();
    assertSupabaseResult(error);
    return data ? { sessionId: data.session_id, text: data.text, language: data.language, updatedAt: data.updated_at } : null;
  }
  return explanations.get(sessionId) ?? null;
}
export async function saveCareExplanation(value: CareExplanation): Promise<CareExplanation> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseAdmin().from("care_explanations").upsert({ session_id: value.sessionId, text: value.text, language: value.language, updated_at: value.updatedAt });
    assertSupabaseResult(error);
    return value;
  }
  explanations.set(value.sessionId, value);
  return value;
}
