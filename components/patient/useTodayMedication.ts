"use client";

import { useCallback, useEffect, useState } from "react";
import type { TodayMedication } from "../../lib/medication/intakeStore";

const REFRESH_MS = 30_000; // 의료진이 바꾼 자동 열림 시각 등을 반영하려고 주기적으로 다시 불러온다

/** 오늘 복약 목록과 다음에 먹을 약. 복용을 기록한 뒤 refresh()로 다시 불러온다. */
export function useTodayMedication(patientId: string) {
  const [today, setToday] = useState<TodayMedication | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/medication?patientId=${encodeURIComponent(patientId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as TodayMedication;
      if (!Array.isArray(data?.items)) throw new Error("invalid medication response");
      setToday(data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [patientId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { today, failed, refresh };
}
