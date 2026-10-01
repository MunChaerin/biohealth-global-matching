"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FacialObservation } from "./FacialObservation";
import { createSoapDraft, getChatSessionId, type SoapDraft } from "../../lib/chatbot/soapDraft";
import type { ChatbotContext } from "../../lib/chatbot/types";
import { defaultPersona, getPatientPersona, patientPersonas } from "../../lib/patient/personas";
import { createConversationObservation } from "../../lib/chatbot/observation";
import styles from "./clinician-dashboard.module.css";

const priorities = [
  { id: "position", tone: "observe", label: "체위 변경 권장", detail: "동일 체위 유지 시간이 2시간을 넘었습니다.", time: "09:05" },
  { id: "sleep", tone: "soft", label: "수면 경과 확인", detail: "지난밤 중간 각성 1회가 기록되었습니다.", time: "09:13" },
];

const days = [
  ["월", 58], ["화", 64], ["수", 48], ["목", 70], ["금", 66], ["토", 73], ["오늘", 61],
];

const emptySoap: SoapDraft = {
  subjective: "환자 대화 정보가 아직 수집되지 않았습니다.",
  subjectiveMeta: "대화 0회",
  objective: "환자 대화가 시작되면 환자 시나리오 기반 참고값과 카메라 관찰을 표시합니다.",
  objectiveMeta: "시나리오 참고값 · 실제 센서 연동 전",
  assessment: "대화가 시작되면 참고 제안을 생성합니다.",
  assessmentMeta: "대기 중",
  plan: "의료진이 최종 계획을 입력합니다.",
  planMeta: "의료진 최종 확정",
  updatedAt: "",
};

export function ClinicianDashboard() {
  const [selectedPersonaId, setSelectedPersonaId] = useState(defaultPersona.id);
  const selectedPersona = getPatientPersona(selectedPersonaId);
  const [soap, setSoap] = useState<SoapDraft>(emptySoap);
  const [plan, setPlan] = useState(emptySoap.plan);
  const [callStatus, setCallStatus] = useState<"requested" | "acknowledged" | null>(null);
  const [explanation, setExplanation] = useState("");
  const [explanationSent, setExplanationSent] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<string[]>([]);
  const [conversation, setConversation] = useState<ChatbotContext["messages"]>([]);
  const [showConversation, setShowConversation] = useState(false);
  const [observation, setObservation] = useState(createConversationObservation({ messages: [], safetyFlags: [], subjective: {}, state: "CHIEF_CONCERN", sessionId: "", patientId: "" }));
  const planEditedRef = useRef(false);

  useEffect(() => {
    const update = async () => {
      try {
        const response = await fetch(`/api/chat/session?sessionId=${getChatSessionId(selectedPersona.id)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { context?: ChatbotContext | null };
        if (!payload.context) return;
        const next = createSoapDraft(payload.context);
        setSoap(next);
        setObservation(createConversationObservation(payload.context));
        setConversation(payload.context.messages);
        if (!planEditedRef.current) setPlan(next.plan);
        if (!explanationSent) setExplanation(next.assessment);
      } catch {
        // 의료진 화면은 마지막 정상 초안을 유지한다.
      }
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [selectedPersona.id]);

  useEffect(() => {
    const updateCall = async () => {
      let localRequested = false;
      try {
        const raw = window.localStorage.getItem("carelink.careCall");
        if (raw) {
          const localCall = JSON.parse(raw) as { patientId?: string; status?: "requested" | "acknowledged" };
          localRequested = localCall.patientId === selectedPersona.id && localCall.status === "requested";
          if (localRequested) setCallStatus("requested");
        }
      } catch { /* 서버 상태를 사용 */ }
      try {
        const response = await fetch(`/api/care/call?patientId=${selectedPersona.id}&t=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          const serverStatus = ((await response.json()) as { call?: { status: "requested" | "acknowledged" } }).call?.status ?? null;
          setCallStatus(serverStatus ?? (localRequested ? "requested" : null));
        }
      } catch {
        if (localRequested) setCallStatus("requested");
      }
    };
    void updateCall();
    const interval = window.setInterval(updateCall, 1500);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "carelink.careCall" || !event.newValue) return;
      try {
        const value = JSON.parse(event.newValue) as { patientId?: string; status?: "requested" | "acknowledged" };
        if (value.patientId === selectedPersona.id && value.status === "requested") setCallStatus("requested");
      } catch { /* 서버 polling으로 계속 확인 */ }
    };
    window.addEventListener("storage", onStorage);
    return () => { window.clearInterval(interval); window.removeEventListener("storage", onStorage); };
  }, [selectedPersona.id]);

  async function acknowledgeCall() {
    const response = await fetch("/api/care/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: selectedPersona.id, action: "acknowledge" }) });
    if (response.ok) {
      setCallStatus("acknowledged");
      try { window.localStorage.setItem("carelink.careCall", JSON.stringify({ patientId: selectedPersona.id, status: "acknowledged", at: Date.now() })); } catch { /* 서버 상태는 저장됨 */ }
    }
  }

  async function sendExplanation() {
    const text = explanation.trim() || `${selectedPersona.name} 어르신, 현재 상태를 확인하고 있습니다. ${soap.assessment}`;
    const response = await fetch("/api/care/explanation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: getChatSessionId(selectedPersona.id), text, language: "ko" }) });
    if (response.ok) { setExplanation(text); setExplanationSent(true); }
  }

  function acknowledgeAlert(id: string) {
    setAcknowledgedAlerts((current) => current.includes(id) ? current : [...current, id]);
  }


  const visiblePriorityCount = priorities.filter((item) => !acknowledgedAlerts.includes(item.id)).length + (callStatus === "requested" && !acknowledgedAlerts.includes("call") ? 1 : 0);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/patient">
          <span className={styles.brandMark}>C</span>
          <span><strong>CareLink</strong><small>의료진 검토 보조</small></span>
        </Link>
        <div className={styles.topbarActions}>
          <span className={styles.updated}>오늘 09:18 업데이트</span>
          <select aria-label="환자 선택" value={selectedPersona.id} onChange={(event) => setSelectedPersonaId(event.target.value)}>
            {patientPersonas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name} · {persona.age}세</option>)}
          </select>
          <Link className={styles.patientLink} href={`/patient?personaId=${selectedPersona.id}`}>환자 화면</Link>
        </div>
      </header>

      <section className={styles.patientHeader}>
          <div className={styles.patientIdentity}>
          <span className={styles.patientAvatar}>정</span>
          <div><p>담당 환자 · 실시간 요약</p><h1>{selectedPersona.name} <small>{selectedPersona.age}세</small></h1><span>{selectedPersona.room} · {selectedPersona.diagnosis}</span></div>
        </div>
        <button className={styles.roundButton} type="button">오늘 회진</button>
      </section>

      <div className={styles.notice}>
        <span>i</span><p><strong>의료진 검토 모드</strong> · 아래 내용은 대화와 센서 정보를 정리한 참고 자료입니다. 진단·처방을 자동으로 수행하지 않습니다.</p>
      </div>

      <section className={styles.prioritySection}>
        <div className={styles.sectionHeading}><div><p>PRIORITY</p><h2>지금 확인할 사항</h2></div><button className={styles.recordToggle} type="button" onClick={() => setShowRecords((value) => !value)}>확인할 기록 {visiblePriorityCount}건 {showRecords ? "⌃" : "›"}</button></div>
        <div className={styles.priorityGrid}>
          {callStatus === "requested" && !acknowledgedAlerts.includes("call") ? <article className={`${styles.priorityCard} ${styles.alert}`}><span className={styles.priorityIcon}>!</span><div><strong>환자가 의료진을 호출했습니다</strong><p>환자 화면의 도움 요청을 확인해 주세요.</p><button type="button" onClick={() => { acknowledgeAlert("call"); void acknowledgeCall(); }}>확인 처리</button></div><time>지금</time></article> : null}
          {priorities.filter((item) => !acknowledgedAlerts.includes(item.id)).map((item) => <article className={`${styles.priorityCard} ${styles[item.tone]}`} key={item.id}><span className={styles.priorityIcon}>{item.tone === "observe" ? "⌁" : "◔"}</span><div><strong>{item.label}</strong><p>{item.detail}</p><button type="button" className={styles.alertConfirm} onClick={() => acknowledgeAlert(item.id)}>확인</button></div><time>{item.time}</time></article>)}
        </div>
        {showRecords ? <div className={styles.recordDetails} role="region" aria-label="확인할 기록 상세"><button type="button" onClick={() => document.querySelector("." + styles.panel)?.scrollIntoView({ behavior: "smooth" })}><b>대화·표정 관찰</b><span>최근 환자 발화와 카메라 관찰 결과를 확인합니다. ›</span></button><button type="button" onClick={() => document.querySelector("." + styles.soap)?.scrollIntoView({ behavior: "smooth" })}><b>SOAP 초안</b><span>수집된 S 정보와 의료진 검토 내용을 확인합니다. ›</span></button>{callStatus === "requested" ? <button type="button" onClick={() => { acknowledgeAlert("call"); void acknowledgeCall(); }}><b>의료진 호출</b><span>환자의 도움 요청을 확인 처리합니다. ›</span></button> : null}</div> : null}
      </section>

      <section className={styles.dashboardGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p>OBJECTIVE SIGNALS · MOCK</p><h2>생체신호 · 모션</h2></div><span className={styles.badge}>연동 전 목업</span></div>
          <div className={styles.metrics}>
            <div><span>맥박</span><strong>{selectedPersona.demoVitals.heartRate} <small>bpm</small></strong><em>시나리오 값</em></div>
            <div><span>SpO₂</span><strong>{selectedPersona.demoVitals.spo2} <small>%</small></strong><em>시나리오 값</em></div>
            <div><span>ECG</span><strong>정상 <small>동성 리듬</small></strong><em>시나리오 값</em></div>
          </div>
          <div className={styles.motion}><div><span>체위·모션 추적</span><strong>{selectedPersona.demoVitals.motion}</strong></div><div className={styles.timeline}><i /><i /><i /><i /></div><div className={styles.timelineLabels}><span>07:00</span><span>08:00</span><span>09:00</span><span>현재</span></div><small className={styles.demoNote}>{selectedPersona.demoVitals.note}</small></div>
          <button className={styles.textButton} type="button">원시 센서 기록 보기 ›</button>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p>OBSERVATION</p><h2>대화·표정 관찰</h2></div><span className={styles.trend}>{observation.trend}</span></div>
          <div className={styles.chart} aria-label="최근 7일 대화 관찰 기록">{days.map(([day, value]) => <div key={day as string}><i style={{ height: `${value}%` }} /><span>{day}</span></div>)}</div>
          <div className={styles.legend}><span><i /> 안정 <b>주요 표현</b></span><span><i /> 보통 <b>혼재</b></span><span><i /> 관찰 <b>확인 필요</b></span></div>
          <div className={styles.insight}>○ <span>{observation.detail} {observation.evidence !== "환자 발화 없음" ? `최근 발화: “${observation.evidence}”` : ""}</span></div>
          <FacialObservation patientId={selectedPersona.id} />
          <div className={styles.conversationLog}>
            <button type="button" className={styles.conversationToggle} onClick={() => setShowConversation((value) => !value)}>{showConversation ? "대화 기록 닫기" : "환자 챗봇 대화 보기"} <span>{conversation.filter((item) => item.role === "patient").length}회</span></button>
            {showConversation ? <div className={styles.conversationMessages} aria-label="환자 챗봇 대화 기록"><small>환자 상태 확인과 의료진 검토를 위한 대화 기록입니다.</small>{conversation.length ? conversation.slice(-8).map((item, index) => <p className={item.role === "patient" ? styles.patientMessage : styles.assistantMessage} key={`${item.createdAt}-${index}`}><b>{item.role === "patient" ? "환자" : "CareLink"}</b>{item.text}</p>) : <small>아직 대화 기록이 없습니다.</small>}</div> : null}
          </div>
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

      <section className={styles.handoff}><div><p>TWO-WAY COMMUNICATION</p><h2>환자에게는 더 쉬운 말로</h2><span>SOAP 초안을 참고해 의료진이 수정한 설명을 환자 화면에 전달합니다.</span></div><div className={styles.preview}><small>환자용 미리보기</small><textarea value={explanation} onChange={(event) => { setExplanationSent(false); setExplanation(event.target.value); }} aria-label="환자에게 전달할 쉬운 설명" /><button type="button" onClick={() => void sendExplanation()}>{explanationSent ? "전달 완료 ✓" : "쉬운 설명 전달하기 ›"}</button></div></section>
      {callStatus === "requested" && !acknowledgedAlerts.includes("call") ? <div className={styles.callModalBackdrop} role="presentation"><section className={styles.callModal} role="alertdialog" aria-modal="true" aria-labelledby="call-modal-title"><span className={styles.callModalIcon}>!</span><div><p>CARE ALERT</p><h2 id="call-modal-title">환자가 의료진을 호출했습니다</h2><span>환자 화면의 도움 요청을 확인해 주세요.</span></div><button type="button" onClick={() => { acknowledgeAlert("call"); void acknowledgeCall(); }}>확인 처리</button></section></div> : null}
    </main>
  );
}
