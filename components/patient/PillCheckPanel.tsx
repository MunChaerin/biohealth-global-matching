"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatLanguage } from "../../lib/chatbot/types";
import type { MedicationItem } from "../../lib/medication/schedule";
import { pillImprint, pillName, withParticle } from "../../lib/pill/catalog";
import type { PillDetection, PillVerdict } from "../../lib/pill/verdict";
import type { PillCheckPhase } from "./usePillCheck";
import styles from "./patient-chat.module.css";

interface Props {
  language: ChatLanguage;
  group: readonly MedicationItem[]; // 이번 복용 시간에 먹을 약 전체 (예: 아침 리리베아 + 타이레놀)
  takenIds: readonly string[]; // 그중 이번 확인에서 [먹었어요]를 누른 약
  phase: PillCheckPhase;
  verdict: PillVerdict;
  cameraProblem: string | null; // 카메라를 쓸 수 없을 때 안내 문구
  needsCameraConsent: boolean; // 표정 관찰 카메라에 동의하지 않아서, 알약 확인용으로만 켤지 물어야 함
  onAllowCamera: () => void;
  onTaken: (item: MedicationItem) => Promise<boolean>;
  onClose: () => void;
  debugShow?: (detections: PillDetection[]) => void;
  evidence?: { drugCode: string; image: string } | null; // 카메라로 본 알약 확대 사진 (판정 근거)
  speak?: (text: string) => void; // 음성 안내 (환자 화면의 음성 기능)
}

const REPEAT_HINT_MS = 6_000; // "한 알씩", "잘 모르겠어요" 같은 안내를 다시 읽어주기까지 최소 간격

/**
 * 알약 확인 모드 안내. 같은 시간에 먹을 약이 여러 알이면 한 알씩 아무 순서로 확인한다.
 * 맞는 약일 때만 [먹었어요]를 누를 수 있고, 눌러야 복용으로 기록된다. 안내는 화면 문구와 음성으로 함께 준다.
 */
export function PillCheckPanel({ language, group, takenIds, phase, verdict, cameraProblem, needsCameraConsent, onAllowCamera, onTaken, onClose, debugShow, evidence, speak }: Props) {
  const ja = language === "ja";
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null); // 방금 [먹었어요]를 누른 약 코드

  const label = (item: MedicationItem) => (ja ? item.japaneseName : item.name);
  const dose = (item: MedicationItem) => (ja ? item.japaneseDose : item.dose);
  const appearance = (item: MedicationItem) => (ja ? item.japaneseAppearance : item.appearance);
  const remaining = group.filter((item) => !takenIds.includes(item.id));
  const takenCodes = group.filter((item) => takenIds.includes(item.id)).map((item) => item.drugCode);
  const allDone = remaining.length === 0;
  const matched = verdict.kind === "match" ? remaining.find((item) => item.drugCode === verdict.drugCode) : undefined;

  // 방금 먹은 약을 화면에서 치우면 "기록했어요" 안내를 끝낸다
  useEffect(() => {
    if (justSaved && !(("drugCode" in verdict) && verdict.drugCode === justSaved)) setJustSaved(null);
  }, [verdict, justSaved]);

  async function taken(item: MedicationItem) {
    setSaving(true);
    setSaveFailed(false);
    const ok = await onTaken(item);
    setSaving(false);
    if (ok) setJustSaved(item.drugCode);
    else setSaveFailed(true);
  }

  /** "리리베아캡슐 50mg(흰색 길쭉한 캡슐)" 목록. 한국어 마지막 약 뒤에 을/를을 붙인다. */
  function listToShow(items: readonly MedicationItem[]): string {
    if (ja) return items.map((item) => `${label(item)}（${appearance(item)}）`).join("、");
    const last = items[items.length - 1]!;
    const head = items.slice(0, -1).map((item) => `${label(item)}(${appearance(item)})`);
    const tail = `${label(last)}(${appearance(last)})${withParticle(label(last), "을", "를").slice(label(last).length)}`;
    return [...head, tail].join(", ");
  }
  const nextPrompt = allDone
    ? ""
    : ja
      ? `${listToShow(remaining)}を見せてください。`
      : `${listToShow(remaining)} 비춰 주세요.`;

  let tone: "info" | "good" | "warn" = "info";
  let status: string;
  let speechKey: string | null = null;
  let speechText: string | null = null;
  if (allDone) {
    tone = "good";
    status = ja ? "今回のお薬はすべて飲みました。記録しました。" : "이번 약을 모두 드셨어요. 기록했어요.";
    speechKey = "allDone";
  } else if (needsCameraConsent) {
    status = ja ? "お薬の確認にカメラを使います。この確認のときだけ使い、映像は保存・送信しません。" : "약 확인에 카메라를 사용해요. 이번 확인에만 쓰고, 영상은 저장하거나 보내지 않아요.";
    speechKey = "consent";
  } else if (cameraProblem) {
    tone = "warn";
    status = cameraProblem;
    speechKey = `camera:${cameraProblem}`;
  } else if (phase === "loading") {
    status = ja ? "お薬の確認を準備しています…" : "약 확인을 준비하고 있어요…";
  } else if (phase === "notReady") {
    tone = "warn";
    status = ja ? "お薬を見分けるモデルがまだ準備されていません。医療スタッフに確認してください。" : "약을 알아보는 모델이 아직 준비되지 않았어요. 의료진에게 확인해 주세요.";
    speechKey = "notReady";
  } else if (phase === "error") {
    tone = "warn";
    status = ja ? "お薬の確認を始められませんでした。医療スタッフに確認してください。" : "약 확인을 시작하지 못했어요. 의료진에게 확인해 주세요.";
    speechKey = "error";
  } else if (justSaved) {
    tone = "good";
    status = ja ? `服薬を記録しました。次は${nextPrompt}` : `복용을 기록했어요. 이제 ${nextPrompt}`;
    speechKey = `saved:${justSaved}`;
  } else {
    switch (verdict.kind) {
      case "noPill": {
        status = ja ? `お薬を1錠だけ、カメラに近づけて見せてください。` : `약을 한 알만 카메라 가까이 비춰 주세요.`;
        const list = remaining.map((item) => `${label(item)} ${dose(item)}`).join(ja ? "、" : ", ");
        speechKey = "start";
        speechText = ja
          ? `今は${list}を飲む時間です。1錠ずつ、カメラに近づけて見せてください。`
          : `지금은 ${list} 드실 시간이에요. 한 알씩 카메라 가까이 비춰 주세요.`;
        break;
      }
      case "multiple":
        tone = "warn";
        status = ja ? "1錠ずつ見せてください。" : "한 번에 한 알씩 비춰 주세요.";
        speechKey = "multiple";
        break;
      case "unsure":
        status = ja ? "どのお薬かよく分かりません。もう少し近づけて、明るいところで見せてください。" : "어떤 약인지 잘 모르겠어요. 조금 더 가까이, 밝은 곳에서 비춰 주세요.";
        speechKey = "unsure";
        break;
      case "checking":
        status = ja ? "確認しています…" : "확인하고 있어요…";
        break;
      case "match":
        tone = "good";
        status = ja
          ? `合っています！${label(matched!)}です。飲んだら「飲みました」を押してください。`
          : `맞아요! ${withParticle(label(matched!), "이에요", "예요")}. 드신 뒤 [먹었어요]를 눌러 주세요.`;
        speechKey = `match:${verdict.drugCode}`;
        break;
      case "mismatch":
        tone = "warn";
        if (takenCodes.includes(verdict.drugCode)) {
          // 방금 먹었다고 누른 약을 다시 비춤
          status = ja ? `このお薬はさっき飲みました。次は${nextPrompt}` : `이 약은 방금 드셨어요. 이제 ${nextPrompt}`;
          speechKey = `again:${verdict.drugCode}`;
        } else {
          const seen = pillName(verdict.drugCode, language);
          status = ja
            ? `これは${seen}です。今飲むお薬ではありません。${nextPrompt}`
            : `이 약은 ${withParticle(seen, "이에요", "예요")}. 지금 드실 약이 아니에요. ${nextPrompt}`;
          speechKey = `mismatch:${verdict.drugCode}`;
        }
        break;
    }
  }

  // 음성 안내: 문구가 바뀔 때만 읽는다. 시작 안내는 한 번만, 반복되는 안내("한 알씩", "잘 모르겠어요")는 간격을 둔다.
  const spokenRef = useRef<{ keys: Set<string>; last: string | null; lastAt: number }>({ keys: new Set(), last: null, lastAt: 0 });
  const toSpeak = speechText ?? status;
  useEffect(() => {
    if (!speak || !speechKey) return;
    const spoken = spokenRef.current;
    if (speechKey === spoken.last) return;
    if (speechKey === "start" && spoken.keys.has("start")) return;
    if ((speechKey === "multiple" || speechKey === "unsure") && Date.now() - spoken.lastAt < REPEAT_HINT_MS) return;
    spoken.keys.add(speechKey);
    spoken.last = speechKey;
    spoken.lastAt = Date.now();
    speak(toSpeak);
  }, [speak, speechKey, toSpeak]);

  const showEvidence = !allDone && !justSaved && (verdict.kind === "match" || verdict.kind === "mismatch") && evidence?.drugCode === verdict.drugCode;
  const seenImprint = showEvidence ? pillImprint(verdict.drugCode) : null;
  const time = group[0]?.time;

  return (
    <div className={styles.pillPanel}>
      <div className={styles.pillHeading}>
        <div>
          <small>{ja ? "今飲むお薬" : "지금 드실 약"}{time ? ` · ${time}` : ""}</small>
          <ul className={styles.pillGroup}>
            {group.map((item) => (
              <li key={item.id} className={takenIds.includes(item.id) ? styles.pillGroupDone : undefined}>
                <b>{takenIds.includes(item.id) ? "✓ " : ""}{label(item)} {dose(item)}</b>
                <span>{appearance(item)}</span>
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className={styles.pillClose} onClick={onClose}>{allDone ? (ja ? "閉じる" : "닫기") : (ja ? "やめる" : "그만하기")}</button>
      </div>
      <p className={`${styles.pillStatus} ${tone === "good" ? styles.pillGood : tone === "warn" ? styles.pillWarn : ""}`} role="status" aria-live="polite">
        {status}
      </p>
      {showEvidence ? (
        <div className={styles.pillEvidence}>
          <img src={evidence!.image} alt={ja ? "カメラで見たお薬" : "카메라로 본 약"} />
          <dl>
            <dt>{ja ? "カメラで見たお薬" : "카메라로 본 약"}</dt>
            <dd>{pillName(verdict.drugCode, language)}{seenImprint ? ` · ${ja ? "刻印" : "각인"} ${seenImprint}` : ""}</dd>
            <dt>{ja ? "登録された今のお薬" : "등록된 지금 드실 약"}</dt>
            {remaining.map((item) => (
              <dd key={item.id}>{label(item)}{item.imprint ? ` · ${ja ? "刻印" : "각인"} ${item.imprint}` : ""}</dd>
            ))}
          </dl>
        </div>
      ) : null}
      {saveFailed ? <small className={styles.pillError}>{ja ? "記録できませんでした。もう一度押してください。" : "기록하지 못했어요. 다시 눌러 주세요."}</small> : null}
      <div className={styles.pillActions}>
        {needsCameraConsent && !allDone ? (
          <button type="button" className={styles.cameraButton} onClick={onAllowCamera}>{ja ? "カメラを使う" : "카메라 켜고 확인하기"}</button>
        ) : null}
        {matched && !justSaved && phase === "running" ? (
          <button type="button" className={styles.pillTaken} onClick={() => void taken(matched)} disabled={saving}>{ja ? "飲みました" : "먹었어요"}</button>
        ) : null}
      </div>
      {debugShow && phase === "running" && !allDone ? (
        <div className={styles.pillDebug} aria-label="개발용 알약 시뮬레이션">
          <small>개발용 (모델 대신)</small>
          {group.map((item) => (
            <button key={item.id} type="button" onClick={() => debugShow([{ drugCode: item.drugCode, confidence: 0.92, box: [0.4, 0.4, 0.2, 0.1] }])}>{item.name}</button>
          ))}
          <button type="button" onClick={() => debugShow([{ drugCode: "K-005849", confidence: 0.9, box: [0.4, 0.4, 0.2, 0.1] }])}>다른 약</button>
          <button type="button" onClick={() => debugShow([{ drugCode: group[0]!.drugCode, confidence: 0.5 }])}>애매함</button>
          <button type="button" onClick={() => debugShow([{ drugCode: "a", confidence: 0.9 }, { drugCode: "b", confidence: 0.9 }])}>여러 알</button>
          <button type="button" onClick={() => debugShow([])}>없음</button>
        </div>
      ) : null}
    </div>
  );
}
