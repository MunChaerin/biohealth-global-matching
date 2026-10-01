import type { ChatbotContext } from "./types";

const globalStore = globalThis as typeof globalThis & {
  __carelinkChatSessions?: Map<string, ChatbotContext>;
};

const sessions = globalStore.__carelinkChatSessions ?? new Map<string, ChatbotContext>();
globalStore.__carelinkChatSessions = sessions;

export function saveChatSession(context: ChatbotContext): void {
  sessions.set(context.sessionId, context);
}

export function getChatSession(sessionId: string): ChatbotContext | undefined {
  return sessions.get(sessionId);
}
