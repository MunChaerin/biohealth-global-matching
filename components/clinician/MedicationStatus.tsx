"use client";

import { useEffect, useRef, useState } from "react";
import type { TodayMedication } from "../../lib/medication/intakeStore";
import styles from "./clinician-dashboard.module.css";

const POLL_INTERVAL_MS = 3_000;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

/** 오늘 복약 일정과 복용 여부. 환자가 카메라로 맞는 약을 확인하고 [먹었어요]를 누르면 복용으로 바뀐다. */
export function MedicationStatus({ patientId }: { patientId: string }) {
  const [today, setToday] = useState<TodayMedication | null>(null);
  const [failed, setFailed] = useState(false);
  // 약 확인 자동 열림 시각: 고치는 중인 값 (복용 시간별), 저장 결과
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<{ time: string; ok: boolean } | null>(null);
  const currentPatientRef = useRef(patientId);
  currentPatientRef.current = patientId;

  // 환자가 바뀌면 고치던 시각과 저장 결과를 지운다
  useEffect(() => {
    setDrafts({});
    setSaved(null);
  }, [patientId]);

  async function saveReminder(time: string, openAt: string) {
    const savingFor = patientId;
    try {
      const response = await fetch("/api/medication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, event: "reminder", time, openAt }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as TodayMedication;
      if (currentPatientRef.current !== savingFor) return; // 저장하는 사이 다른 환자로 바뀌면 결과를 버린다
      setToday(data);
      setDrafts(({ [time]: _done, ...rest }) => rest);
      setSaved({ time, ok: true });
    } catch {
      if (currentPatientRef.current === savingFor) setSaved({ time, ok: false });
    }
  }

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
                  {/* "다른 약을 비춤 N회"는 표시하지 않는다: 판정 범위를 이번 복용 시간의 약으로 좁힌 뒤로 웹은 일정 밖의 약을
                      "잘 모르겠어요"(unknown)로 보내므로 mismatched가 오지 않는다. 서버 집계(mismatchCount)는 규격 호환을 위해 남겨 둔다. */}
                </div>
                <em>
                  {item.status === "taken" && item.takenAt ? `복용 ${formatTime(item.takenAt)}` : "미복용"}
                  {item.status === "taken" && item.method === "manual" ? <span className={styles.medManual}>직접 기록</span> : null}
                  {item.status === "taken" && item.method === "confirmed" ? <span className={styles.medManual}>사진 확인</span> : null}
                </em>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.facialEmpty}>등록된 복약 일정이 없습니다.</p>
        )
      ) : null}
      {today?.reminders?.length ? (
        <div className={styles.reminders} aria-label="약 확인 자동 열림 시각">
          <b>약 확인 자동 열림</b>
          <small>정한 시각이 되면 환자 화면에서 약 확인이 저절로 열려요 (하루에 한 번).</small>
          {today.reminders.map((reminder) => {
            const value = drafts[reminder.time] ?? reminder.openAt;
            return (
              <label key={reminder.time}>
                <span>{reminder.time} 복용</span>
                <input
                  type="time"
                  value={value}
                  aria-label={`${reminder.time} 복용 약 확인 자동 열림 시각`}
                  onChange={(event) => setDrafts((current) => ({ ...current, [reminder.time]: event.target.value }))}
                />
                <button type="button" onClick={() => void saveReminder(reminder.time, value)} disabled={value === reminder.openAt}>저장</button>
                {saved?.time === reminder.time ? <em>{saved.ok ? "저장했어요" : "저장하지 못했어요"}</em> : null}
              </label>
            );
          })}
        </div>
      ) : null}
      <small className={styles.facialFoot}>환자가 카메라로 약을 확인한 뒤 직접 누른 기록이에요. "사진 확인"은 모델이 애매해서 확대 사진을 보고 환자가 맞다고 고른 기록, "직접 기록"은 카메라로 확인하지 못하고 환자가 직접 남긴 기록이에요. 실제 복용은 의료진이 확인해 주세요.</small>
    </section>
  );
}
