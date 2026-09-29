import Link from "next/link";
import styles from "./clinician-dashboard.module.css";

const priorities = [
  { tone: "observe", label: "체위 변경 권장", detail: "동일 체위 유지 시간이 2시간을 넘었습니다.", time: "09:05" },
  { tone: "soft", label: "수면 경과 확인", detail: "지난밤 중간 각성 1회가 기록되었습니다.", time: "09:13" },
];

const days = [
  ["월", 58], ["화", 64], ["수", 48], ["목", 70], ["금", 66], ["토", 73], ["오늘", 61],
];

export function ClinicianDashboard() {
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
        </article>
      </section>

      <section className={styles.soap}>
        <div className={styles.soapHeading}><div><p>MEDICAL REVIEW</p><h2>SOAP 보고서 초안</h2><span>대화, 생체신호, 모션 정보에 근거한 검토용 초안입니다.</span></div><button type="button">초안 저장</button></div>
        <div className={styles.soapGrid}>
          <article className={styles.soapS}><b>S</b><div><h3>Subjective <small>대화 기반</small></h3><p>어젯밤 중간에 한 번 깼으나 다시 잠들었다고 말씀하심. 허리 부위 불편감은 4/10 정도이며, “창밖을 보니 기분이 조금 나아졌다”고 표현함.</p><span>대화 09:12–09:16 · 수면 · 통증 · 기분</span></div></article>
          <article className={styles.soapO}><b>O</b><div><h3>Objective <small>센서 · 모션</small></h3><p>맥박 76 bpm, SpO₂ 97%로 안정 범위. 최근 2시간 6분 동안 동일 체위 유지. 표정과 대화에서 안정적인 표현이 주로 관찰됨.</p><span>SpO₂ 97% · 체위 2시간 6분</span></div></article>
          <article className={styles.soapA}><b>A</b><div><h3>Assessment <small>참고 제안</small></h3><p>현재 활력징후는 안정적이나 수면 중 각성과 경도 요통이 있어 장시간 동일 체위에 대한 경과 관찰이 필요함.</p><span>근거 · 중간 각성 1회 · 요통 4/10</span></div></article>
          <article className={styles.soapP}><b>P</b><div><h3>Plan <small>의료진 편집</small></h3><textarea defaultValue="체위 변경을 보조하고 허리 불편감 재확인. 점심 전 5분간 창가 대화 또는 음악 감상을 제안." aria-label="치료 계획 편집" /><span>의료진 최종 확정</span></div></article>
        </div>
      </section>

      <section className={styles.handoff}><div><p>TWO-WAY COMMUNICATION</p><h2>환자에게는 더 쉬운 말로</h2><span>검토한 결과를 일상 언어로 바꾸어 환자 화면에 전달합니다.</span></div><div className={styles.preview}><small>환자용 미리보기</small><p>자세를 편하게 바꿔 드리고, 오늘 저녁에 허리 불편감과 잠은 다시 살펴볼게요.</p><button type="button">쉬운 설명 전달하기 ›</button></div></section>
    </main>
  );
}
