"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CameraIndicator } from "./CameraIndicator";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { SafetyNotice } from "./SafetyNotice";
import { usePatientChat } from "./usePatientChat";
import { useSpeech } from "./useSpeech";
import styles from "./patient-chat.module.css";

const quickReplies = ["허리가 조금 불편해요", "기분은 괜찮아요", "창밖을 보고 싶어요"];

export function PatientChat() {
  const { context, error, isLoading, safetyHold, sendMessage } = usePatientChat();
  const speech = useSpeech();
  const endRef = useRef<HTMLDivElement>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [medicationTaken, setMedicationTaken] = useState(false);

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
      <header className={styles.siteHeader}>
        <Link className={styles.brand} href="/patient"><span className={styles.brandMark}>C</span><span><strong>CareLink</strong><small>돌봄을 더 가까이</small></span></Link>
        <nav className={styles.roleNav} aria-label="역할 화면 전환"><Link className={styles.roleActive} href="/patient">환자 화면</Link><Link href="/clinician">의료진 화면</Link></nav>
        <span className={styles.headerStatus}>✓ 의료진 검토 보조</span>
      </header>

      <section className={styles.patientWelcome}>
        <div><p className={styles.sectionKicker}>오늘의 돌봄 대화</p><h1>정희 어르신, 좋은 아침이에요.</h1><p>천천히 말씀하셔도 괜찮아요. 오늘 기분은 어떠세요?</p></div>
        <div className={styles.patientTools}><span className={styles.languageSwitch}>언어 · <b>한국어</b>　日本語</span><button type="button">글자 크게</button></div>
      </section>

      <div className={styles.notice}><span>i</span><p><b>한국어</b>로 대화하고 있어요. 말씀이 잘 들리지 않으면 음성 입력이 보조해 드립니다.</p></div>

      <div className={styles.patientLayout}>
        <section className={styles.conversationCard} aria-label="환자용 건강 대화">
          <div className={styles.conversationHead}><div className={styles.assistantIdentity}><span className={styles.assistantDot}>✦</span><div><b>마음 돌봄 친구</b><small><i /> 함께 듣고 있어요</small></div></div><span className={styles.voiceLabel}>◖ 음성으로 듣기</span></div>
          <section className={styles.messages} aria-live="polite" aria-busy={isLoading}>
            {context.messages.map((item, index) => <ChatMessage key={`${item.createdAt}-${index}`} message={item} canSpeak={speech.synthesisSupported} isSpeaking={speech.isSpeaking} onSpeak={speech.speak} onStopSpeaking={speech.stopSpeaking} />)}
            {isLoading ? <p className={styles.loading}>답변을 확인하고 있어요...</p> : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {safetyHold ? <SafetyNotice /> : null}<div ref={endRef} />
          </section>
          <div className={styles.replyArea}><p>지금 마음에 가까운 말을 골라 보세요.</p><div className={styles.quickReplies}>{quickReplies.map((reply) => <button type="button" key={reply} onClick={() => void handleSend(reply)} disabled={isLoading || safetyHold}>{reply}　›</button>)}</div><ChatInput disabled={safetyHold} isLoading={isLoading} onSend={handleSend} isListening={speech.isListening} recognitionSupported={speech.recognitionSupported} speechError={speech.speechError} onStartListening={speech.startListening} onStopListening={speech.stopListening} /></div>
          <div className={styles.assistStrip}>◌　발음이 불분명할 때는 <b>STT 음성 입력 보조</b>가 함께 작동해요.</div>
        </section>

        <aside className={styles.patientSide}>
          <section className={styles.moodCard}><div className={styles.cardHeading}><div><p>오늘의 대화 관찰</p><h2>편안한 표현이 많았어요</h2></div><span className={styles.moodFace}>☺</span></div><div className={styles.moodMeter}><span /><i /></div><div className={styles.moodLabels}><span>조금 지침</span><b>편안함</b></div><p className={styles.subtle}>최근 대화에서 관찰된 표현을 정리한 참고 정보예요.</p></section>
          <section className={styles.careCallCard}><span className={styles.callIcon}>⌁</span><div><p>도움이 필요하세요?</p><small>담당 의료진에게 바로 알려드려요.</small></div><button type="button" className={isCalling ? styles.called : ""} onClick={() => setIsCalling(true)} disabled={isCalling}>{isCalling ? "요청을 알렸어요" : "의료진 부르기"}</button>{isCalling ? <small className={styles.callConfirm}>담당 의료진에게 도움 요청을 알렸어요.</small> : null}</section>
          <CameraIndicator />
        </aside>
      </div>

      <div className={styles.bottomGrid}><section className={styles.medicineCard}><div className={styles.cardHeading}><div><p>다음 약 복용</p><h2>오전 혈압약</h2><small>오전 10:00 · 흰색 타원형</small></div><span className={styles.medicineIcon}>＋</span></div><div className={styles.medicineAction}><span>카메라로 알약 모양을 확인할 수 있어요.</span><button type="button" onClick={() => setMedicationTaken(true)} className={medicationTaken ? styles.completed : ""}>{medicationTaken ? "✓ 복용 확인" : "복용했어요"}</button></div></section><section className={styles.easyPlanCard}><div className={styles.planTitle}><span>♡</span><div><p>오늘의 설명</p><h2>의료진이 쉽게 알려드려요</h2></div></div><p>정희 어르신, 오늘은 자세를 한 번 바꿔 드리고 저녁에 허리 불편감과 잠을 다시 살펴볼게요.</p><button type="button" onClick={() => speech.speak("정희 어르신, 오늘은 자세를 한 번 바꿔 드리고 저녁에 허리 불편감과 잠을 다시 살펴볼게요.")}>음성으로 듣기　›</button></section></div>
      <p className={styles.footnote}>ⓘ 건강 상태 표시는 돌봄을 돕기 위한 참고 정보이며, 진단이나 응급 판단을 대신하지 않습니다.</p>
    </main>
  );
}
