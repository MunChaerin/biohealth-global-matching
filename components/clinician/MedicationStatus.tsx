"use client";

import { useEffect, useState } from "react";
import type { TodayMedication } from "../../lib/medication/intakeStore";
import { pillName } from "../../lib/pill/catalog";
import styles from "./clinician-dashboard.module.css";

const POLL_INTERVAL_MS = 3_000;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

/** 오늘 복약 일정과 복용 여부. 환자가 카메라로 맞는 약을 확인하고 [먹었어요]를 누르면 복용으로 바뀐다. */
export function MedicationStatus({ patientId }: { patientId: string }) {
  const [today, setToday] = useState<TodayMedication | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setToday(null);
    async function load() {
      try {
        const response = await fetch(`/api/medication?patientId=${encodeURIComponent(patientId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as TodayMedication;
        if (!cancelled) {
          setToday(data);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [patientId]);

  const takenCount = today?.items.filter((item) => item.status === "taken").length ?? 0;

  return (
    <section className={styles.medication} aria-label="오늘 복약 현황">
      <div className={styles.panelHeading}>
        <div><p>MEDICATION</p><h2>오늘 복약 현황</h2></div>
        <span className={styles.badge}>{today ? `${takenCount} / ${today.items.length} 복용` : failed ? "불러오지 못함" : "불러오는 중"}</span>
      </div>
      {today ? (
        today.items.length ? (
          <ul className={styles.medicationList}>
            {today.items.map((item) => (
              <li key={item.id} className={item.status === "taken" ? styles.medTaken : styles.medPending}>
                <span className={styles.medTime}>{item.time}</span>
                <div>
                  <b>{item.name} {item.dose}</b>
                  <small>{item.appearance}</small>
                  {item.mismatchCount > 0 ? (
                    <small className={styles.medMismatch}>
                      다른 약을 비춤 {item.mismatchCount}회
                      {item.lastMismatch ? ` · 마지막: ${pillName(item.lastMismatch.detectedDrugCode, "ko")} (${formatTime(item.lastMismatch.at)})` : ""}
                    </small>
                  ) : null}
                </div>
                <em>
                  {item.status === "taken" && item.takenAt ? `복용 ${formatTime(item.takenAt)}` : "미복용"}
                  {item.status === "taken" && item.method === "manual" ? <span className={styles.medManual}>직접 기록</span> : null}
                </em>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.facialEmpty}>등록된 복약 일정이 없습니다.</p>
        )
      ) : null}
      <small className={styles.facialFoot}>환자가 카메라로 약을 확인한 뒤 직접 누른 기록이에요. "직접 기록"은 카메라로 확인하지 못하고 환자가 직접 남긴 기록이에요. 실제 복용은 의료진이 확인해 주세요.</small>
    </section>
  );
}
