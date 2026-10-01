import type { ChatMessage as ChatMessageData } from "../../lib/chatbot/types";
import type { ChatLanguage } from "../../lib/chatbot/types";
import styles from "./patient-chat.module.css";

interface ChatMessageProps {
  message: ChatMessageData;
  canSpeak?: boolean;
  isSpeaking?: boolean;
  onSpeak?: (text: string) => void;
  onStopSpeaking?: () => void;
  language?: ChatLanguage;
}

export function ChatMessage({ message, canSpeak, isSpeaking, onSpeak, onStopSpeaking, language = "ko" }: ChatMessageProps) {
  const isPatient = message.role === "patient";
  const isJapanese = language === "ja";

  return (
    <article
      className={`${styles.messageRow} ${isPatient ? styles.patientRow : styles.assistantRow}`}
      aria-label={isPatient ? (isJapanese ? "自分のメッセージ" : "내 메시지") : (isJapanese ? "ケアチャットボットのメッセージ" : "돌봄 챗봇 메시지")}
    >
      <div className={`${styles.messageBubble} ${isPatient ? styles.patientBubble : styles.assistantBubble}`}>
        <span className={styles.messageAuthor}>{isPatient ? (isJapanese ? "私" : "나") : (isJapanese ? "ケアチャットボット" : "돌봄 챗봇")}</span>
        <p>{message.text}</p>
        {!isPatient && canSpeak ? (
          <button
            className={styles.speakButton}
            type="button"
            onClick={() => isSpeaking ? onStopSpeaking?.() : onSpeak?.(message.text)}
          >
            {isSpeaking ? (isJapanese ? "停止" : "읽기 중지") : (isJapanese ? "もう一度聞く" : "다시 듣기")}
          </button>
        ) : null}
      </div>
    </article>
  );
}
