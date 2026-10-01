"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatLanguage } from "../../lib/chatbot/types";
import styles from "./patient-chat.module.css";

interface ChatInputProps {
  disabled: boolean;
  isLoading: boolean;
  onSend: (text: string) => Promise<void>;
  isListening: boolean;
  recognitionSupported: boolean;
  speechError: string | null;
  onStartListening: (onTranscript: (text: string) => void) => void;
  onStopListening: () => void;
  placeholder?: string;
  onFinish?: () => void;
  finishDisabled?: boolean;
  language?: ChatLanguage;
}

export function ChatInput({
  disabled,
  isLoading,
  onSend,
  isListening,
  recognitionSupported,
  speechError,
  onStartListening,
  onStopListening,
  placeholder = "불편한 점을 편하게 말씀해 주세요.",
  onFinish,
  finishDisabled = false,
  language = "ko",
}: ChatInputProps) {
  const [text, setText] = useState("");

  async function submit() {
    const value = text.trim();
    if (!value || disabled || isLoading) return;

    onStopListening();
    setText("");
    await onSend(value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form className={styles.inputForm} onSubmit={handleSubmit}>
      <label className={styles.inputLabel} htmlFor="patient-message">
        챗봇에게 보낼 내용
      </label>
      <div className={styles.inputRow}>
        <textarea
          id="patient-message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? (language === "ja" ? "医療スタッフからの案内を確認してください。" : "의료진 연결 안내를 확인해 주세요.") : placeholder}
          rows={2}
          disabled={disabled || isLoading}
        />
        <div className={styles.inputActions}>
          <button
            className={styles.voiceButton}
            type="button"
            disabled={disabled || isLoading || !recognitionSupported}
            aria-pressed={isListening}
            onClick={() => isListening
              ? onStopListening()
              : onStartListening((transcript) => setText((current) => `${current}${current ? " " : ""}${transcript}`))}
          >
          {isListening ? (language === "ja" ? "停止" : "듣기 중지") : (language === "ja" ? "話す" : "말하기")}
          </button>
          <button className={styles.sendButton} type="submit" disabled={disabled || isLoading || text.trim().length === 0}>
            {isLoading ? (language === "ja" ? "送信中" : "전송 중") : (language === "ja" ? "送信" : "보내기")}
          </button>
          {onFinish ? <button className={styles.finishButton} type="button" onClick={onFinish} disabled={disabled || isLoading || finishDisabled}>{language === "ja" ? "終了" : "대화 마치기"}</button> : null}
        </div>
      </div>
      {speechError ? <p className={styles.speechStatus} role="status">{speechError}</p> : null}
      {!recognitionSupported ? <p className={styles.speechStatus}>이 브라우저에서는 음성 입력을 지원하지 않아요.</p> : null}
    </form>
  );
}
