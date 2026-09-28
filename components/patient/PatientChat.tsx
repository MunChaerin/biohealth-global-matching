"use client";

import { useEffect, useRef } from "react";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { SafetyNotice } from "./SafetyNotice";
import { usePatientChat } from "./usePatientChat";
import { useSpeech } from "./useSpeech";
import styles from "./patient-chat.module.css";

export function PatientChat() {
  const { context, error, isLoading, safetyHold, sendMessage } = usePatientChat();
  const speech = useSpeech();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [context.messages, isLoading]);

  async function handleSend(text: string) {
    speech.stopListening();
    const output = await sendMessage(text);
    if (output?.patientReply) speech.speak(output.patientReply);
  }

  return (
    <main className={styles.pageShell}>
      <section className={styles.chatPanel} aria-label="환자용 건강 대화">
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>환자용 대화</span>
            <h1>오늘의 상태 확인</h1>
          </div>
          <span className={styles.status} aria-label="연결 상태">
            <span aria-hidden="true" /> 연결됨
          </span>
        </header>

        <div className={styles.intro}>
          <strong>천천히 답해도 괜찮습니다.</strong>
          <p>한 번에 한 가지씩 여쭤볼게요. 진료가 아니라 의료진의 확인을 돕기 위한 대화입니다.</p>
        </div>

        <section className={styles.messages} aria-live="polite" aria-busy={isLoading}>
          {context.messages.map((item, index) => (
            <ChatMessage
              key={`${item.createdAt}-${index}`}
              message={item}
              canSpeak={speech.synthesisSupported}
              isSpeaking={speech.isSpeaking}
              onSpeak={speech.speak}
              onStopSpeaking={speech.stopSpeaking}
            />
          ))}
          {isLoading ? <p className={styles.loading}>답변을 확인하고 있어요...</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {safetyHold ? <SafetyNotice /> : null}
          <div ref={endRef} />
        </section>

        <footer className={styles.composer}>
          <ChatInput
            disabled={safetyHold}
            isLoading={isLoading}
            onSend={handleSend}
            isListening={speech.isListening}
            recognitionSupported={speech.recognitionSupported}
            speechError={speech.speechError}
            onStartListening={speech.startListening}
            onStopListening={speech.stopListening}
          />
          <p>긴급한 상황이라면 이 화면을 기다리지 말고 가까운 의료진에게 바로 알려 주세요.</p>
        </footer>
      </section>
    </main>
  );
}
