"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatLanguage } from "../../lib/chatbot/types";
import type { MedicationItem } from "../../lib/medication/schedule";
import { pillImprint, pillName, withParticle } from "../../lib/pill/catalog";
import type { PillDetection, PillVerdict } from "../../lib/pill/verdict";
import type { CapsuleCheck, PillCheckPhase } from "./usePillCheck";
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
  onTaken: (item: MedicationItem, method: "camera" | "manual") => Promise<boolean>;
  onClose: () => void;
  debugShow?: (detections: PillDetection[]) => void;
  evidence?: { drugCode: string; image: string } | null; // 카메라로 본 알약 확대 사진 (판정 근거)
  speak?: (text: string) => void; // 음성 안내 (환자 화면의 음성 기능)
  capsule?: CapsuleCheck | null; // 흰 캡슐 각인 확인 (읽는 중 / 환자에게 묻는 중)
  onCapsuleAnswer?: (yes: boolean) => void;
}

const REPEAT_HINT_MS = 6_000; // "한 알씩", "잘 모르겠어요" 같은 안내를 다시 읽어주기까지 최소 간격
export const MANUAL_OFFER_MS = 8_000; // 이만큼 계속 알아보지 못하면 직접 기록 버튼을 보여준다

/**
 * 알약 확인 모드 안내. 같은 시간에 먹을 약이 여러 알이면 한 알씩 아무 순서로 확인한다.
 * 맞는 약일 때만 [먹었어요]를 누를 수 있고, 눌러야 복용으로 기록된다. 안내는 화면 문구와 음성으로 함께 준다.
 * 모델·카메라를 쓸 수 없거나 한참 동안 약을 알아보지 못하면 카메라 없이 직접 기록할 수 있다 (의료진 화면에 "직접 기록"으로 표시).
 */
export function PillCheckPanel({ language, group, takenIds, phase, verdict, cameraProblem, needsCameraConsent, onAllowCamera, onTaken, onClose, debugShow, evidence, speak, capsule, onCapsuleAnswer }: Props) {
  const ja = language === "ja";
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null); // 방금 [먹었어요]를 누른 약 코드
  const [struggling, setStruggling] = useState(false); // 한참 동안 "잘 모르겠어요"/"한 알씩"만 나옴
  const [manualOpen, setManualOpen] = useState(false);

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

  // 알아보지 못하는 상태가 계속되면 직접 기록을 제안한다 (한 번 보이면 이번 확인 동안 유지)
  const unclear = verdict.kind === "unsure" || verdict.kind === "multiple";
  useEffect(() => {
    if (!unclear || struggling) return;
    const timer = setTimeout(() => setStruggling(true), MANUAL_OFFER_MS);
    return () => clearTimeout(timer);
  }, [unclear, struggling]);

  async function taken(item: MedicationItem, method: "camera" | "manual" = "camera") {
    setSaving(true);
    setSaveFailed(false);
    const ok = await onTaken(item, method);
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
  } else if (capsule?.kind === "ask") {
    const imprint = pillImprint(capsule.drugCode) ?? "";
    status = ja
      ? `カプセルに「${imprint}」の文字が見えますか？写真を見て教えてください。`
      : `캡슐에 ${imprint} 글자가 보이나요? 사진을 보고 알려 주세요.`;
    speechKey = `ask:${capsule.drugCode}`;
  } else if (capsule?.kind === "reading" && verdict.kind !== "match" && verdict.kind !== "mismatch") {
    status = ja ? "カプセルに刻まれた文字を確認しています…" : "캡슐에 새겨진 글자를 확인하고 있어요…";
  } else {
    switch (verdict.kind) {
      case "noPill": {
        status = ja ? `お薬を1錠だけ、画面の真ん中の四角の中に近づけて見せてください。` : `약을 한 알만 화면 가운데 네모 안에 가까이 비춰 주세요.`;
        const list = remaining.map((item) => `${label(item)} ${dose(item)}`).join(ja ? "、" : ", ");
        speechKey = "start";
        speechText = ja
          ? `今は${list}を飲む時間です。1錠ずつ、画面の真ん中の四角の中に見せてください。`
          : `지금은 ${list} 드실 시간이에요. 한 알씩 화면 가운데 네모 안에 비춰 주세요.`;
        break;
      }
      case "multiple":
        tone = "warn";
        status = ja ? "1錠ずつ見せてください。" : "한 번에 한 알씩 비춰 주세요.";
        speechKey = "multiple";
        break;
      case "unsure":
        // 글자 없는 면(예: 캡슐 뒷면)만 보이면 비슷한 약과 구분이 안 되므로 각인이 보이게 돌려 달라고 한다
        status = ja
          ? "どのお薬かよく分かりません。お薬に刻まれた文字がカメラに見えるように向きを変えて、近づけて見せてください。"
          : "어떤 약인지 잘 모르겠어요. 약에 새겨진 글자가 카메라 쪽으로 보이게 돌려서, 가까이 비춰 주세요.";
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
  const recognitionFailed = phase === "notReady" || phase === "error" || Boolean(cameraProblem) || struggling;
  const offerManual = !allDone && !matched && (recognitionFailed || needsCameraConsent);

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
      {capsule?.kind === "ask" && !allDone && !justSaved ? (
        <div className={styles.pillAsk}>
          {capsule.image ? <img src={capsule.image} alt={ja ? "カメラで見たカプセル" : "카메라로 본 캡슐"} /> : null}
          <div>
            <button type="button" className={styles.pillTaken} onClick={() => onCapsuleAnswer?.(true)}>{ja ? "見えます" : "맞아요"}</button>
            <button type="button" className={styles.pillAskNo} onClick={() => onCapsuleAnswer?.(false)}>{ja ? "見えません" : "아니에요"}</button>
          </div>
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
      {offerManual ? (
        manualOpen ? (
          <div className={styles.pillManual}>
            <small>{ja ? "カメラで確認できないときは、飲んだお薬を直接押してください。医療スタッフには「手動記録」と表示されます。" : "카메라로 확인이 안 되면 드신 약을 직접 눌러 주세요. 의료진에게는 \"직접 기록\"으로 보여요."}</small>
            {remaining.map((item) => (
              <button key={item.id} type="button" onClick={() => void taken(item, "manual")} disabled={saving}>
                {ja ? `${label(item)}を飲みました` : `${withParticle(label(item), "을", "를")} 먹었어요`}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className={styles.pillManualOpen} onClick={() => setManualOpen(true)}>
            {ja ? "カメラを使わずに記録する" : "카메라 없이 직접 기록하기"}
          </button>
        )
      ) : null}
      {debugShow && phase === "running" && !allDone ? (
        <div className={styles.pillDebug} aria-label="개발용 알약 시뮬레이션">
          <small>개발용 (모델 대신)</small>
          {group.map((item) => (
            <button key={item.id} type="button" onClick={() => debugShow([{ drugCode: item.drugCode, confidence: 0.92, box: [0.4, 0.4, 0.2, 0.1] }])}>{item.name}</button>
          ))}
          <button type="button" onClick={() => debugShow([{ drugCode: "K-005849", confidence: 0.9, box: [0.4, 0.4, 0.2, 0.1] }])}>다른 약</button>
          <button type="button" onClick={() => debugShow([{ drugCode: group[0]!.drugCode, confidence: 0.5 }])}>애매함</button>
          <button type="button" onClick={() => debugShow([{ drugCode: "K-045037", confidence: 0.7, box: [0.4, 0.4, 0.2, 0.1] }])}>흰 캡슐</button>
          <button type="button" onClick={() => debugShow([{ drugCode: "a", confidence: 0.9 }, { drugCode: "b", confidence: 0.9 }])}>여러 알</button>
          <button type="button" onClick={() => debugShow([])}>없음</button>
        </div>
      ) : null}
    </div>
  );
}
