"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getPatientPersona, patientPersonas } from "../../lib/patient/personas";
import { MOTION_THRESHOLDS, type MotionReport, type MotionStatus } from "../../lib/motion/types";
import { useMotionTracking } from "./useMotionTracking";
import styles from "./motion-tracking.module.css";

const fastThresholds = { absenceSeconds: 10, lowMovementSeconds: 20, stillSeconds: 30 } as const;
const statusCopy: Record<MotionStatus, { label: string; detail: string; tone: string }> = {
  present: { label: "정상 감지", detail: "환자와 움직임이 확인되고 있어요.", tone: "good" },
  noFace: { label: "얼굴 확인 중", detail: "카메라 화면 안에 얼굴이 들어오게 해 주세요.", tone: "neutral" },
  lowMovement: { label: "주의 알림", detail: "1분 이상 움직임이 적어요. 자세를 확인해 주세요.", tone: "warning" },
  still: { label: "장시간 정지", detail: "3분 이상 움직임이 거의 없어요.", tone: "danger" },
  away: { label: "자리 비움", detail: "화면에서 환자가 보이지 않아요. 자동 알림은 보내지 않습니다.", tone: "away" },
  cameraUnavailable: { label: "카메라 사용 불가", detail: "카메라 권한과 연결 상태를 확인해 주세요.", tone: "danger" },
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}분 ${rest}초` : `${rest}초`;
}

interface MotionTrackingProps {
  initialPatientId?: string;
}

export function MotionTracking({ initialPatientId }: MotionTrackingProps) {
  const [selectedId, setSelectedId] = useState(getPatientPersona(initialPatientId).id);
  const [fastMode, setFastMode] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const persona = getPatientPersona(selectedId);
  const thresholds = fastMode ? fastThresholds : MOTION_THRESHOLDS;
  const { videoRef, report, loading, error } = useMotionTracking(selectedId, enabled, thresholds);
  const status = report?.status ?? (error ? "cameraUnavailable" : "noFace");
  const copy = statusCopy[status];
  const alertActive = status === "lowMovement" || status === "still";
  const thresholdText = useMemo(() => fastMode ? "초단기 시연: 자리 비움 10초 · 주의 20초 · 정지 30초" : "테스트 기준: 자리 비움 30초 · 주의 1분 · 장시간 정지 3분", [fastMode]);

  useEffect(() => {
    setEnabled(true);
  }, [selectedId]);

  return (
    <main className={styles.page}>
      <header className={styles.header}><Link href="/clinician" className={styles.back}>‹ 의료진 화면</Link><div><p>MOTION TRACKING</p><h1>모션 트래킹</h1><span>카메라 기반 움직임·자리 비움 관찰</span></div><label className={styles.patientSelect}>환자 선택<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{patientPersonas.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.age}세</option>)}</select></label></header>
      <div className={styles.notice}><b>관찰 원칙</b><span>원본 영상은 저장하지 않고, 분석된 상태값만 전달합니다. 자리 비움은 자동 알림을 보내지 않습니다.</span></div>
      <section className={styles.grid}>
        <article className={styles.cameraCard}><div className={styles.cardHeading}><div><p>LIVE CAMERA</p><h2>{persona.name} · {persona.room}</h2></div><span className={`${styles.status} ${styles[copy.tone]}`}>{copy.label}</span></div><div className={styles.videoFrame}><video ref={videoRef} muted playsInline autoPlay aria-label="모션 트래킹 웹캠 미리보기" />{loading ? <div className={styles.videoOverlay}>웹캠과 모션 분석을 준비하고 있어요...</div> : null}{error ? <div className={styles.videoOverlay}>{error}</div> : null}</div><div className={styles.cameraActions}><button type="button" onClick={() => setEnabled((value) => !value)}>{enabled ? "카메라 끄기" : "카메라 켜기"}</button><label><input type="checkbox" checked={fastMode} onChange={(event) => setFastMode(event.target.checked)} /> 시연용 단축 기준</label></div></article>
        <aside className={styles.summary}><p>MOTION STATUS</p><h2>{copy.label}</h2><strong>{copy.detail}</strong><dl><div><dt>움직임 없음</dt><dd>{formatDuration(report?.stillnessSeconds ?? 0)}</dd></div><div><dt>자리 비움</dt><dd>{formatDuration(report?.absenceSeconds ?? 0)}</dd></div><div><dt>마지막 감지</dt><dd>{report?.lastDetectedAt ? new Date(report.lastDetectedAt).toLocaleTimeString("ko-KR") : "기록 없음"}</dd></div><div><dt>마지막 움직임</dt><dd>{report?.lastMovementAt ? new Date(report.lastMovementAt).toLocaleTimeString("ko-KR") : "기록 없음"}</dd></div></dl><div className={`${styles.alertBox} ${alertActive ? styles.alertOn : ""}`}><b>{alertActive ? "알림 대상 상태" : status === "away" ? "자리 비움 상태" : "알림 없음"}</b><span>{alertActive ? "환자·의료진 화면에 안내가 표시됩니다." : status === "away" ? "화장실·검사 등 정상적인 이동일 수 있어요." : "움직임 상태가 기준을 넘으면 안내합니다."}</span></div></aside>
      </section>
      <section className={styles.rules}><div><p>DETECTION RULES</p><h2>현재 적용 기준</h2></div><span>{thresholdText}</span></section>
    </main>
  );
}
