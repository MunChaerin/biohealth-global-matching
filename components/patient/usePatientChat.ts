"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatLanguage,
  ChatbotContext,
  ChatbotTurnOutput,
  ChatMessage,
  SafetyFlag,
  SubjectiveData,
} from "../../lib/chatbot/types";
import { CHAT_CONTEXT_STORAGE_KEY } from "../../lib/chatbot/soapDraft";

const firstQuestion = "오늘 가장 불편한 점은 무엇인가요?";
const firstQuestionJapanese = "今日、いちばんつらいことは何ですか？";

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function message(role: ChatMessage["role"], text: string): ChatMessage {
  return { role, text, createdAt: new Date().toISOString() };
}

function mergeSafetyFlags(current: SafetyFlag[], incoming: SafetyFlag[]): SafetyFlag[] {
  const seen = new Set(current.map((flag) => `${flag.type}:${flag.severity}:${flag.evidence}`));
  return [...current, ...incoming.filter((flag) => !seen.has(`${flag.type}:${flag.severity}:${flag.evidence}`))];
}

export function usePatientChat() {
  const ids = useMemo(() => ({ sessionId: createId("session"), patientId: createId("patient") }), []);
  const [context, setContext] = useState<ChatbotContext>({
    ...ids,
    state: "CHIEF_CONCERN",
    messages: [message("assistant", firstQuestion)],
    subjective: {},
    safetyFlags: [],
    language: "ko",
  });
  const contextRef = useRef(context);
  const requestInFlight = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionAction, setSessionAction] = useState<ChatbotTurnOutput["sessionAction"]>("continue");

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_CONTEXT_STORAGE_KEY, JSON.stringify(context));
    } catch {
      // 저장소를 사용할 수 없는 환경에서도 대화 자체는 계속한다.
    }
  }, [context]);

  function commit(next: ChatbotContext) {
    contextRef.current = next;
    setContext(next);
  }

  function setLanguage(language: ChatLanguage) {
    const current = contextRef.current;
    const firstMessage = current.messages[0];
    const isInitialQuestion = firstMessage?.role === "assistant" && (firstMessage.text === firstQuestion || firstMessage.text === firstQuestionJapanese);
    commit({
      ...current,
      language,
      messages: isInitialQuestion
        ? [{ ...firstMessage, text: language === "ja" ? firstQuestionJapanese : firstQuestion }, ...current.messages.slice(1)]
        : current.messages,
    });
  }

  function finishSession() {
    commit({ ...contextRef.current, state: "READY_FOR_SOAP" });
    setSessionAction("complete");
  }

  async function sendMessage(patientText: string): Promise<ChatbotTurnOutput | undefined> {
    if (requestInFlight.current || sessionAction === "handoff" || sessionAction === "complete" || contextRef.current.state === "SAFETY_HOLD" || contextRef.current.state === "READY_FOR_SOAP") return;

    requestInFlight.current = true;
    setIsLoading(true);
    setError(null);

    const patientMessage = message("patient", patientText);
    const previousContext = contextRef.current;
    const requestContext = {
      ...previousContext,
      messages: [...contextRef.current.messages, patientMessage],
    };
    commit(requestContext);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: requestContext, patientText }),
      });

      const payload = (await response.json()) as ChatbotTurnOutput | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "응답을 불러오지 못했습니다.");
      }

      const output = payload as ChatbotTurnOutput;
      const nextSafetyFlags = mergeSafetyFlags(requestContext.safetyFlags, output.safetyFlags);
      const nextSubjective: SubjectiveData = { ...requestContext.subjective, ...output.subjectivePatch };
      const nextContext: ChatbotContext = {
        ...requestContext,
        state: output.conversationState,
        messages: [...requestContext.messages, message("assistant", output.patientReply)],
        subjective: nextSubjective,
        safetyFlags: nextSafetyFlags,
      };
      commit(nextContext);
      setSessionAction(output.sessionAction);
      return output;
    } catch (error) {
      console.error("chat request failed", error);
      commit(previousContext);
      setError("잠시 연결이 원활하지 않습니다. 잠시 후 다시 말씀해 주세요.");
      return undefined;
    } finally {
      requestInFlight.current = false;
      setIsLoading(false);
    }
  }

  const safetyHold = context.state === "SAFETY_HOLD" || sessionAction === "handoff" || context.safetyFlags.length > 0;

  const isComplete = sessionAction === "complete" || context.state === "READY_FOR_SOAP";
  return { context, error, isLoading, safetyHold, isComplete, finishSession, setLanguage, sendMessage };
}
