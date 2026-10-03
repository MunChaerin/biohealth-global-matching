"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TodayMedication } from "../../lib/medication/intakeStore";

const REFRESH_MS = 30_000; // 의료진이 바꾼 자동 열림 시각 등을 반영하려고 주기적으로 다시 불러온다

/** 오늘 복약 목록과 다음에 먹을 약. 복용을 기록한 뒤 refresh()로 다시 불러온다. */
export function useTodayMedication(patientId: string) {
  const [today, setToday] = useState<TodayMedication | null>(null);
  const [failed, setFailed] = useState(false);
  // 지금 화면의 환자. 환자가 바뀐 뒤에 도착한 이전 환자의 응답은 버린다
  const currentPatientRef = useRef(patientId);
  currentPatientRef.current = patientId;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/medication?patientId=${encodeURIComponent(patientId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as TodayMedication;
      if (!Array.isArray(data?.items)) throw new Error("invalid medication response");
      if (currentPatientRef.current !== patientId) return;
      setToday(data);
      setFailed(false);
    } catch {
      if (currentPatientRef.current === patientId) setFailed(true);
    }
  }, [patientId]);

  useEffect(() => {
    // 환자가 바뀌면 이전 환자의 복약 정보를 바로 지운다 (새 정보가 올 때까지 이전 약으로 자동 열림·표시가 되지 않게)
    setToday(null);
    setFailed(false);
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { today, failed, refresh };
}
