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

export function getCareCall(patientId: string) { return calls.get(patientId) ?? null; }
export function requestCareCall(patientId: string, sessionId: string) {
  const current = calls.get(patientId);
  if (current?.status === "requested") return current;
  const call: CareCall = { patientId, sessionId, status: "requested", requestedAt: new Date().toISOString() };
  calls.set(patientId, call);
  return call;
}
export function acknowledgeCareCall(patientId: string) {
  const current = calls.get(patientId);
  if (!current) return null;
  const next = { ...current, status: "acknowledged" as const, acknowledgedAt: new Date().toISOString() };
  calls.set(patientId, next);
  return next;
}
export function getCareExplanation(sessionId: string) { return explanations.get(sessionId) ?? null; }
export function saveCareExplanation(value: CareExplanation) { explanations.set(value.sessionId, value); return value; }
