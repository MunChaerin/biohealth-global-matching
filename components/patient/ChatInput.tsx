"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
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
      <label className={styles.srOnly} htmlFor="patient-message">
        챗봇에게 보낼 내용
      </label>
      <textarea
        id="patient-message"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "의료진 연결 안내를 확인해 주세요." : placeholder}
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
          {isListening ? "듣기 중지" : "말하기"}
        </button>
        <button className={styles.sendButton} type="submit" disabled={disabled || isLoading || text.trim().length === 0}>
          {isLoading ? "전송 중" : "보내기"}
        </button>
      </div>
      {speechError ? <p className={styles.speechStatus} role="status">{speechError}</p> : null}
      {!recognitionSupported ? <p className={styles.speechStatus}>이 브라우저에서는 음성 입력을 지원하지 않아요.</p> : null}
    </form>
  );
}
