import type { ChatbotContext } from "./types";
import { assertSupabaseResult, getSupabaseAdmin, isSupabaseConfigured, requireProductionStorage } from "../supabase/server";

const globalStore = globalThis as typeof globalThis & {
  __carelinkChatSessions?: Map<string, ChatbotContext>;
};

const sessions = globalStore.__carelinkChatSessions ?? new Map<string, ChatbotContext>();
globalStore.__carelinkChatSessions = sessions;

export async function saveChatSession(context: ChatbotContext): Promise<void> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseAdmin().from("chat_sessions").upsert({ session_id: context.sessionId, patient_id: context.patientId, context, updated_at: new Date().toISOString() });
    assertSupabaseResult(error);
    return;
  }
  sessions.set(context.sessionId, context);
}

export async function getChatSession(sessionId: string): Promise<ChatbotContext | undefined> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseAdmin().from("chat_sessions").select("context").eq("session_id", sessionId).maybeSingle();
    assertSupabaseResult(error);
    return data?.context as ChatbotContext | undefined;
  }
  return sessions.get(sessionId);
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseAdmin().from("chat_sessions").delete().eq("session_id", sessionId);
    assertSupabaseResult(error);
    return;
  }
  sessions.delete(sessionId);
}
