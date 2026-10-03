"use client";

import { useEffect, useState } from "react";
import { DEMO_PATIENT_ID, type CameraReport, type CameraStatus } from "../../lib/camera/report";
import type { DominantState } from "../../lib/camera/types";
import styles from "./clinician-dashboard.module.css";

const POLL_INTERVAL_MS = 5_000;
const STALE_AFTER_MS = 30_000; // 환자 화면은 10초마다 보내므로 30초 넘게 소식이 없으면 연결 끊김으로 본다

type StoredReport = CameraReport & { receivedAt: string };

export const dominantLabels: Record<DominantState, string> = {
  calm: "평온",
  pain: "통증 표정",
  anxiety: "불안 표정",
  lethargy: "무기력 표정",
  sleeping: "수면",
  none: "뚜렷한 표정 없음",
};

const statusLabels: Record<CameraStatus, string> = {
  off: "환자가 카메라를 끔",
  paused: "알약 확인 중 (표정 관찰 잠시 멈춤)",
  starting: "카메라 켜는 중",
  calibrating: "기준 표정 수집 중",
  measuring: "측정 중",
  noFace: "얼굴이 보이지 않음",
  permissionDenied: "카메라 권한 꺼짐",
  unavailable: "카메라 사용 불가",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** 환자 화면 카메라의 표정 판정 결과(숫자)를 보여준다. 알림 없이 상태 표시만 한다. */
export function FacialObservation({ patientId = DEMO_PATIENT_ID }: { patientId?: string }) {
  const [report, setReport] = useState<StoredReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/camera?patientId=${encodeURIComponent(patientId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { report: StoredReport | null };
        if (!cancelled) setReport(data.report);
      } catch {
        // 다음 주기에 다시 시도
      } finally {
        if (!cancelled) {
          setLoaded(true);
          setNow(Date.now());
        }
      }
    }
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [patientId]);

  const stale = report ? now - Date.parse(report.receivedAt) > STALE_AFTER_MS : false;
  const badge = !report ? (loaded ? "연결 없음" : "불러오는 중") : stale ? "연결 끊김" : statusLabels[report.status];
  const ratios = report?.trend
    ? (Object.entries(report.trend.dominantRatio) as [DominantState, number][])
        .filter(([, ratio]) => ratio > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  return (
    <section className={styles.facial} aria-label="카메라 표정 관찰">
      <div className={styles.facialHeading}>
        <b>표정 관찰 <small>카메라 · 참고</small></b>
        <span className={stale || !report || report.status !== "measuring" ? styles.facialBadgeIdle : styles.facialBadge}>
          {badge}
        </span>
      </div>

      {!report ? (
        <p className={styles.facialEmpty}>환자 화면에서 카메라가 켜지면 표정 관찰 결과가 표시됩니다.</p>
      ) : (
        <>
          {report.current && !stale ? (
            <p className={styles.facialNow}>지금 <strong>{dominantLabels[report.current.dominant]}</strong></p>
          ) : null}
          {ratios.length ? (
            <div className={styles.facialRatios}>
              <small>{stale ? "마지막 기록" : `최근 ${report.trend?.windowMinutes}분`}</small>
              {ratios.map(([key, ratio]) => (
                <div key={key} className={styles.facialRatio}>
                  <span>{dominantLabels[key]}</span>
                  <i><em style={{ width: `${Math.round(ratio * 100)}%` }} /></i>
                  <b>{Math.round(ratio * 100)}%</b>
                </div>
              ))}
            </div>
          ) : null}
          {report.trend?.flatExpressionFlag ? (
            <p className={styles.facialNote}>
              최근 표정 변화가 거의 없어요. 파킨슨 가면양 얼굴·표현 억제일 수 있어 표정만으로 판단하지 말고 대화·생체신호와 함께 확인하세요.
            </p>
          ) : null}
          <small className={styles.facialFoot}>마지막 수신 {formatTime(report.receivedAt)} · 진단이 아닌 참고 정보</small>
        </>
      )}
    </section>
  );
}
