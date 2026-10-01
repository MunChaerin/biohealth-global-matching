"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FacialObservation } from "./FacialObservation";
import { createSoapDraft, DEMO_CHAT_SESSION_ID, type SoapDraft } from "../../lib/chatbot/soapDraft";
import type { ChatbotContext } from "../../lib/chatbot/types";
import styles from "./clinician-dashboard.module.css";

const priorities = [
  { tone: "observe", label: "체위 변경 권장", detail: "동일 체위 유지 시간이 2시간을 넘었습니다.", time: "09:05" },
  { tone: "soft", label: "수면 경과 확인", detail: "지난밤 중간 각성 1회가 기록되었습니다.", time: "09:13" },
];

const days = [
  ["월", 58], ["화", 64], ["수", 48], ["목", 70], ["금", 66], ["토", 73], ["오늘", 61],
];

const emptySoap: SoapDraft = {
  subjective: "환자 대화 정보가 아직 수집되지 않았습니다.",
  subjectiveMeta: "대화 0회",
  objective: "현재 실제 카메라·센서·모션 값은 아직 연결되지 않았습니다.",
  objectiveMeta: "O 데이터 소스 연동 대기",
  assessment: "대화가 시작되면 참고 제안을 생성합니다.",
  assessmentMeta: "대기 중",
  plan: "의료진이 최종 계획을 입력합니다.",
  planMeta: "의료진 최종 확정",
  updatedAt: "",
};

export function ClinicianDashboard() {
  const [soap, setSoap] = useState<SoapDraft>(emptySoap);
  const [plan, setPlan] = useState(emptySoap.plan);
  const planEditedRef = useRef(false);

  useEffect(() => {
    const update = async () => {
      try {
        const response = await fetch(`/api/chat/session?sessionId=${DEMO_CHAT_SESSION_ID}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { context?: ChatbotContext | null };
        if (!payload.context) return;
        const next = createSoapDraft(payload.context);
        setSoap(next);
        if (!planEditedRef.current) setPlan(next.plan);
      } catch {
        // 의료진 화면은 마지막 정상 초안을 유지한다.
      }
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/patient">
          <span className={styles.brandMark}>C</span>
          <span><strong>CareLink</strong><small>의료진 검토 보조</small></span>
        </Link>
        <div className={styles.topbarActions}>
          <span className={styles.updated}>오늘 09:18 업데이트</span>
          <Link className={styles.patientLink} href="/patient">환자 화면</Link>
        </div>
      </header>

      <section className={styles.patientHeader}>
        <div className={styles.patientIdentity}>
          <span className={styles.patientAvatar}>정</span>
          <div><p>담당 환자 · 실시간 요약</p><h1>김정희 <small>82세</small></h1><span>햇살관 203호 · 장기요양 2등급</span></div>
        </div>
        <button className={styles.roundButton} type="button">오늘 회진</button>
      </section>

      <div className={styles.notice}>
        <span>i</span><p><strong>의료진 검토 모드</strong> · 아래 내용은 대화와 센서 정보를 정리한 참고 자료입니다. 진단·처방을 자동으로 수행하지 않습니다.</p>
      </div>

      <section className={styles.prioritySection}>
        <div className={styles.sectionHeading}><div><p>PRIORITY</p><h2>지금 확인할 사항</h2></div><span>확인할 기록 2건 ›</span></div>
        <div className={styles.priorityGrid}>
          {priorities.map((item) => <article className={`${styles.priorityCard} ${styles[item.tone]}`} key={item.label}><span className={styles.priorityIcon}>{item.tone === "observe" ? "⌁" : "◔"}</span><div><strong>{item.label}</strong><p>{item.detail}</p></div><time>{item.time}</time></article>)}
        </div>
      </section>

      <section className={styles.dashboardGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p>OBJECTIVE SIGNALS</p><h2>생체신호 · 모션</h2></div><span className={styles.badge}>현재 기록</span></div>
          <div className={styles.metrics}>
            <div><span>맥박</span><strong>76 <small>bpm</small></strong><em>안정</em></div>
            <div><span>SpO₂</span><strong>97 <small>%</small></strong><em>안정</em></div>
            <div><span>ECG</span><strong>정상 <small>리듬</small></strong><em>안정</em></div>
          </div>
          <div className={styles.motion}><div><span>체위·모션 추적</span><strong>2시간 6분 동일 체위</strong></div><div className={styles.timeline}><i /><i /><i /><i /></div><div className={styles.timelineLabels}><span>07:00</span><span>08:00</span><span>09:00</span><span>현재</span></div></div>
          <button className={styles.textButton} type="button">원시 센서 기록 보기 ›</button>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p>OBSERVATION</p><h2>대화·표정 관찰</h2></div><span className={styles.trend}>↗ 안정 표현 증가</span></div>
          <div className={styles.chart} aria-label="최근 7일 대화 관찰 기록">{days.map(([day, value]) => <div key={day as string}><i style={{ height: `${value}%` }} /><span>{day}</span></div>)}</div>
          <div className={styles.legend}><span><i /> 안정 <b>주요 표현</b></span><span><i /> 보통 <b>혼재</b></span><span><i /> 관찰 <b>확인 필요</b></span></div>
          <div className={styles.insight}>○ <span>오늘 아침 대화에서 “창밖을 보고 싶다”는 표현이 관찰되었습니다.</span></div>
          <FacialObservation />
        </article>
      </section>

      <section className={styles.soap}>
        <div className={styles.soapHeading}><div><p>MEDICAL REVIEW · LIVE DEMO</p><h2>SOAP 보고서 초안</h2><span>환자 챗봇 대화가 업데이트될 때마다 서버 세션을 통해 갱신되는 검토용 초안입니다.</span></div><button type="button">초안 저장</button></div>
        <div className={styles.soapGrid}>
          <article className={styles.soapS}><b>S</b><div><h3>Subjective <small>대화 기반</small></h3><p>{soap.subjective}</p><span>{soap.subjectiveMeta}</span></div></article>
          <article className={styles.soapO}><b>O</b><div><h3>Objective <small>연동 대기</small></h3><p>{soap.objective}</p><span>{soap.objectiveMeta}</span></div></article>
          <article className={styles.soapA}><b>A</b><div><h3>Assessment <small>참고 제안</small></h3><p>{soap.assessment}</p><span>{soap.assessmentMeta}</span></div></article>
          <article className={styles.soapP}><b>P</b><div><h3>Plan <small>의료진 편집</small></h3><textarea value={plan} onChange={(event) => { planEditedRef.current = true; setPlan(event.target.value); }} aria-label="치료 계획 편집" /><span>{soap.planMeta}</span></div></article>
        </div>
      </section>

      <section className={styles.handoff}><div><p>TWO-WAY COMMUNICATION</p><h2>환자에게는 더 쉬운 말로</h2><span>검토한 결과를 일상 언어로 바꾸어 환자 화면에 전달합니다.</span></div><div className={styles.preview}><small>환자용 미리보기</small><p>자세를 편하게 바꿔 드리고, 오늘 저녁에 허리 불편감과 잠은 다시 살펴볼게요.</p><button type="button">쉬운 설명 전달하기 ›</button></div></section>
    </main>
  );
}
