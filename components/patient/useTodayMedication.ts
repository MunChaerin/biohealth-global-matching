"use client";

import { useCallback, useEffect, useState } from "react";
import type { TodayMedication } from "../../lib/medication/intakeStore";

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
  }, [refresh]);

  return { today, failed, refresh };
}
