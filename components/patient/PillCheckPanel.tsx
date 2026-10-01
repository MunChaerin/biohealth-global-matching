"use client";

import { useState } from "react";
import type { ChatLanguage } from "../../lib/chatbot/types";
import type { MedicationItem } from "../../lib/medication/schedule";
import { pillName, withParticle } from "../../lib/pill/catalog";
import type { PillDetection, PillVerdict } from "../../lib/pill/verdict";
import type { PillCheckPhase } from "./usePillCheck";
import styles from "./patient-chat.module.css";

interface Props {
  language: ChatLanguage;
  medication: MedicationItem;
  phase: PillCheckPhase;
  verdict: PillVerdict;
  cameraProblem: string | null; // 카메라를 쓸 수 없을 때 안내 문구
  needsCameraConsent: boolean; // 표정 관찰 카메라에 동의하지 않아서, 알약 확인용으로만 켤지 물어야 함
  onAllowCamera: () => void;
  onTaken: () => Promise<boolean>;
  onClose: () => void;
  debugShow?: (detections: PillDetection[]) => void;
}

/** 알약 확인 모드 안내. 맞는 약일 때만 [먹었어요]를 누를 수 있고, 눌러야 복용으로 기록된다. */
export function PillCheckPanel({ language, medication, phase, verdict, cameraProblem, needsCameraConsent, onAllowCamera, onTaken, onClose, debugShow }: Props) {
  const ja = language === "ja";
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const name = ja ? medication.japaneseName : medication.name;
  const appearance = ja ? medication.japaneseAppearance : medication.appearance;
  const dose = ja ? medication.japaneseDose : medication.dose;

  async function taken() {
    setSaving(true);
    setSaveFailed(false);
    const ok = await onTaken();
    setSaving(false);
    if (ok) setSaved(true);
    else setSaveFailed(true);
  }

  let tone: "info" | "good" | "warn" = "info";
  let status: string;
  if (saved) {
    tone = "good";
    status = ja ? "服薬を記録しました。" : "복용을 기록했어요.";
  } else if (needsCameraConsent) {
    status = ja ? "お薬の確認にカメラを使います。この確認のときだけ使い、映像は保存・送信しません。" : "약 확인에 카메라를 사용해요. 이번 확인에만 쓰고, 영상은 저장하거나 보내지 않아요.";
  } else if (cameraProblem) {
    tone = "warn";
    status = cameraProblem;
  } else if (phase === "loading") {
    status = ja ? "お薬の確認を準備しています…" : "약 확인을 준비하고 있어요…";
  } else if (phase === "notReady") {
    tone = "warn";
    status = ja ? "お薬を見分けるモデルがまだ準備されていません。医療スタッフに確認してください。" : "약을 알아보는 모델이 아직 준비되지 않았어요. 의료진에게 확인해 주세요.";
  } else if (phase === "error") {
    tone = "warn";
    status = ja ? "お薬の確認を始められませんでした。医療スタッフに確認してください。" : "약 확인을 시작하지 못했어요. 의료진에게 확인해 주세요.";
  } else {
    switch (verdict.kind) {
      case "noPill":
        status = ja ? "お薬を1錠だけ、カメラに近づけて見せてください。" : "약을 한 알만 카메라 가까이 비춰 주세요.";
        break;
      case "multiple":
        tone = "warn";
        status = ja ? "1錠ずつ見せてください。" : "한 번에 한 알씩 비춰 주세요.";
        break;
      case "unsure":
        status = ja ? "どのお薬かよく分かりません。もう少し近づけて、明るいところで見せてください。" : "어떤 약인지 잘 모르겠어요. 조금 더 가까이, 밝은 곳에서 비춰 주세요.";
        break;
      case "checking":
        status = ja ? "確認しています…" : "확인하고 있어요…";
        break;
      case "match":
        tone = "good";
        status = ja ? `合っています！${name}です。飲んだら「飲みました」を押してください。` : `맞아요! ${withParticle(name, "이에요", "예요")}. 드신 뒤 [먹었어요]를 눌러 주세요.`;
        break;
      case "mismatch":
        tone = "warn";
        status = ja
          ? `これは${pillName(verdict.drugCode, "ja")}です。今飲むお薬ではありません。${name}（${appearance}）を見せてください。`
          : `이 약은 ${withParticle(pillName(verdict.drugCode, "ko"), "이에요", "예요")}. 지금 드실 약이 아니에요. ${name}(${appearance})${withParticle(name, "을", "를").slice(name.length)} 비춰 주세요.`;
        break;
    }
  }

  return (
    <div className={styles.pillPanel}>
      <div className={styles.pillHeading}>
        <div>
          <small>{ja ? "今飲むお薬" : "지금 드실 약"} · {medication.time}</small>
          <b>{name} {dose}</b>
          <span>{appearance}</span>
        </div>
        <button type="button" className={styles.pillClose} onClick={onClose}>{saved ? (ja ? "閉じる" : "닫기") : (ja ? "やめる" : "그만하기")}</button>
      </div>
      <p className={`${styles.pillStatus} ${tone === "good" ? styles.pillGood : tone === "warn" ? styles.pillWarn : ""}`} role="status" aria-live="polite">
        {status}
      </p>
      {saveFailed ? <small className={styles.pillError}>{ja ? "記録できませんでした。もう一度押してください。" : "기록하지 못했어요. 다시 눌러 주세요."}</small> : null}
      <div className={styles.pillActions}>
        {needsCameraConsent ? (
          <button type="button" className={styles.cameraButton} onClick={onAllowCamera}>{ja ? "カメラを使う" : "카메라 켜고 확인하기"}</button>
        ) : null}
        {!saved && verdict.kind === "match" && phase === "running" ? (
          <button type="button" className={styles.pillTaken} onClick={() => void taken()} disabled={saving}>{ja ? "飲みました" : "먹었어요"}</button>
        ) : null}
      </div>
      {debugShow && phase === "running" ? (
        <div className={styles.pillDebug} aria-label="개발용 알약 시뮬레이션">
          <small>개발용 (모델 대신)</small>
          <button type="button" onClick={() => debugShow([{ drugCode: medication.drugCode, confidence: 0.92 }])}>맞는 약</button>
          <button type="button" onClick={() => debugShow([{ drugCode: "pending:other", confidence: 0.9 }])}>다른 약</button>
          <button type="button" onClick={() => debugShow([{ drugCode: medication.drugCode, confidence: 0.5 }])}>애매함</button>
          <button type="button" onClick={() => debugShow([{ drugCode: "a", confidence: 0.9 }, { drugCode: "b", confidence: 0.9 }])}>여러 알</button>
          <button type="button" onClick={() => debugShow([])}>없음</button>
        </div>
      ) : null}
    </div>
  );
}
