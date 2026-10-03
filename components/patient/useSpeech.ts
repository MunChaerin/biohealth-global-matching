"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionResultEventLike {
  results: ArrayLike<{ 0: { transcript: string } }>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function recognitionErrorMessage(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "음성 입력을 사용하려면 브라우저에서 마이크를 허용해 주세요.";
  }
  if (error === "no-speech") return "음성이 들리지 않았어요. 다시 말해 주세요.";
  return "음성 입력을 시작하지 못했어요. 직접 입력해 주세요.";
}

const SPEAK_AFTER_CANCEL_MS = 120;

export function useSpeech(language: "ko" | "ja" = "ko") {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptHandlerRef = useRef<(text: string) => void>(() => undefined);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [synthesisSupported, setSynthesisSupported] = useState(false);

  useEffect(() => {
    setRecognitionSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    setSynthesisSupported("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);

    // iOS Safari는 사용자가 화면을 터치한 그 순간(이벤트 처리 중)에 한 번 말해야 그 뒤의 음성 안내가 나온다.
    // 약 확인 안내는 화면 상태가 바뀔 때(터치 밖에서) 말하므로, 처음 터치할 때 소리 없는 문장을 한 번 말해 풀어 둔다.
    function unlock() {
      if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
      const silent = new SpeechSynthesisUtterance(" ");
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
      window.speechSynthesis.resume?.();
      removeUnlock();
    }
    function removeUnlock() {
      for (const type of ["pointerdown", "touchend", "click", "keydown"]) document.removeEventListener(type, unlock, true);
    }
    for (const type of ["pointerdown", "touchend", "click", "keydown"]) document.addEventListener(type, unlock, true);

    return () => {
      removeUnlock();
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  const startListening = useCallback((onTranscript: (text: string) => void) => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechError("이 브라우저에서는 음성 입력을 지원하지 않아요. 직접 입력해 주세요.");
      return;
    }

    transcriptHandlerRef.current = onTranscript;
    setSpeechError(null);
    const recognition = new Recognition();
    recognition.lang = language === "ja" ? "ja-JP" : "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) transcriptHandlerRef.current(transcript);
    };
    recognition.onerror = (event) => setSpeechError(recognitionErrorMessage(event.error));
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setIsListening(true);

    try {
      recognition.start();
    } catch {
      setIsListening(false);
      setSpeechError("음성 입력을 시작하지 못했어요. 직접 입력해 주세요.");
    }
  }, [language]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window) || !text.trim()) return;

    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "ja" ? "ja-JP" : "ko-KR";
    utterance.rate = 0.95;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    // 말하는 중이면 끊고 새 안내를 말한다. iOS Safari는 cancel() 직후 바로 speak()하면 새 문장이 빠지는 경우가 있어 잠깐 기다린다.
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setTimeout(() => synth.speak(utterance), SPEAK_AFTER_CANCEL_MS);
    } else {
      synth.speak(utterance);
    }
    synth.resume?.(); // iOS에서 멈춘(paused) 상태로 남는 경우
  }, [language]);

  return {
    isListening,
    isSpeaking,
    recognitionSupported,
    synthesisSupported,
    speechError,
    speak,
    startListening,
    stopListening,
    stopSpeaking,
  };
}
