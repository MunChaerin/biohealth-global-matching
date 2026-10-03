"use client";

import { useEffect, useState } from "react";
import { DEMO_PATIENT_ID, type CameraStatus } from "../../lib/camera/report";
import type { ChatLanguage } from "../../lib/chatbot/types";
import type { MedicationItem } from "../../lib/medication/schedule";
import { PillCheckPanel } from "./PillCheckPanel";
import { sendReport, useFaceExpression, type ExpressionAnalysis, type MouthAssistStatus } from "./useFaceExpression";
import { usePillCheck } from "./usePillCheck";
import styles from "./patient-chat.module.css";

// 환자가 카메라를 켜기로 동의했는지. 한 번 정하면 이 기기에서 기억하고, 언제든 끌 수 있다.
export const CAMERA_CONSENT_KEY = "carelink.cameraConsent";
type Consent = "unknown" | "on" | "off";

function readConsent(): Consent {
  try {
    const value = window.localStorage.getItem(CAMERA_CONSENT_KEY);
    return value === "on" || value === "off" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

function saveConsent(value: "on" | "off") {
  try {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, value);
  } catch {
    // 저장이 안 되면 이번 화면에서만 적용
  }
}

const messages: Record<ChatLanguage, Record<Exclude<CameraStatus, "off">, { text: string; hint?: string; active: boolean }>> = {
  ko: {
  starting: { text: "표정 관찰 카메라를 켜고 있어요", active: false },
  calibrating: { text: "표정 관찰 카메라 작동 중", hint: "평소 표정으로 잠시 계셔 주세요", active: true },
  measuring: { text: "표정 관찰 카메라 작동 중", active: true },
  noFace: { text: "표정 관찰 카메라 작동 중", hint: "얼굴이 화면 안에 들어오게 해 주세요", active: true },
  paused: { text: "약 확인 중이라 표정 관찰을 잠시 멈췄어요", active: true },
  permissionDenied: { text: "카메라 권한이 꺼져 있어 표정 관찰을 하지 않아요", active: false },
  unavailable: { text: "카메라를 사용할 수 없어 표정 관찰을 하지 않아요", active: false },
  },
  ja: {
    starting: { text: "表情観察カメラを起動しています", active: false },
    calibrating: { text: "表情観察カメラが作動中です", hint: "普段の表情でしばらくお待ちください", active: true },
    measuring: { text: "表情観察カメラが作動中です", active: true },
    noFace: { text: "表情観察カメラが作動中です", hint: "顔が画面に入るようにしてください", active: true },
    paused: { text: "お薬の確認中のため表情観察を一時停止しています", active: true },
    permissionDenied: { text: "カメラの権限がないため観察していません", active: false },
    unavailable: { text: "カメラを使用できないため観察していません", active: false },
  },
};

/**
 * 환자 화면의 표정 관찰 카메라. 처음에는 안내와 함께 켤지 묻고, 켜면 작은 미리보기와 끄기 버튼을 보여준다.
 * 끄면 카메라·분석·전송이 모두 멈추고, 의료진 화면에는 "환자가 카메라를 끔"만 한 번 알린다.
 * 영상은 브라우저 안에서만 쓰고 저장·전송하지 않는다.
 */
/** 알약 확인 모드로 열 때 넘긴다. 이 동안 카드가 커지고 표정 분석은 잠시 멈춘다. */
export interface PillCheckRequest {
  medications: MedicationItem[]; // 이번 복용 시간에 먹을 약 (한 알씩 확인)
  debug?: boolean; // 모델 없이 버튼으로 화면 흐름 확인 (?pillDebug=1)
  onClose: () => void;
  onTaken: (item: MedicationItem) => void;
  speak?: (text: string) => void; // 약 확인 결과 음성 안내
}

export function CameraIndicator({ language = "ko", patientId = DEMO_PATIENT_ID, speechAssistActive = false, pillCheck }: { language?: ChatLanguage; patientId?: string; speechAssistActive?: boolean; pillCheck?: PillCheckRequest | null }) {
  const [consent, setConsent] = useState<Consent>("unknown");
  const [loaded, setLoaded] = useState(false);
  const [mouthStatus, setMouthStatus] = useState<MouthAssistStatus>("waiting");
  // 표정 관찰에 동의하지 않은 환자도 알약 확인할 때는 그때만 카메라를 켤 수 있다
  const [pillCameraAllowed, setPillCameraAllowed] = useState(false);
  // 이번 약 확인에서 [먹었어요]를 누른 약 (같은 시간에 여러 알일 때 남은 약을 계속 확인)
  const [takenIds, setTakenIds] = useState<string[]>([]);
  const pillMode = !!pillCheck;
  const pillGroup = pillCheck?.medications ?? [];
  const remainingPills = pillGroup.filter((item) => !takenIds.includes(item.id));
  const cameraEnabled = consent === "on" || (pillMode && pillCameraAllowed);
  const analysis: ExpressionAnalysis = pillMode ? (consent === "on" ? "paused" : "off") : "on";
  const { videoRef, status, previewFilter, correctedFrame, cameraSize } = useFaceExpression(cameraEnabled, patientId, setMouthStatus, analysis);
  const cameraWorking = cameraEnabled && status !== "off" && status !== "starting" && status !== "permissionDenied" && status !== "unavailable";
  const pill = usePillCheck({
    active: pillMode && cameraWorking,
    medications: remainingPills,
    takenCodes: pillGroup.filter((item) => takenIds.includes(item.id)).map((item) => item.drugCode),
    patientId,
    videoRef,
    correctedFrame,
    debug: pillCheck?.debug,
  });

  useEffect(() => {
    if (!pillMode) {
      setPillCameraAllowed(false); // 알약 확인이 끝나면 다음 확인 때 다시 묻는다
      setTakenIds([]);
    }
  }, [pillMode]);

  useEffect(() => {
    setConsent(readConsent());
    setLoaded(true);
  }, []);

  function turnOn() {
    saveConsent("on");
    setConsent("on");
  }

  function turnOff() {
    saveConsent("off");
    setConsent("off");
    void sendReport({ patientId, measuredAt: new Date().toISOString(), status: "off" });
  }

  const isJapanese = language === "ja";
  const message = status === "off" ? null : messages[language][status];
  const live = consent === "on" && !!message?.active;

  const cameraProblem =
    status === "permissionDenied"
      ? isJapanese ? "カメラの権限がないため、お薬を確認できません。" : "카메라 권한이 꺼져 있어 약을 확인할 수 없어요."
      : status === "unavailable"
        ? isJapanese ? "カメラを使用できないため、お薬を確認できません。" : "카메라를 사용할 수 없어 약을 확인할 수 없어요."
        : cameraEnabled && !cameraWorking
          ? isJapanese ? "カメラを起動しています…" : "카메라를 켜고 있어요…"
          : null;
  const showVideo = pillMode ? cameraWorking : live;

  return (
    <div
      className={`${styles.cameraIndicator} ${pillMode ? styles.cameraPillMode : live ? styles.cameraLive : ""}`}
      role={pillMode ? "dialog" : "status"}
      aria-label={pillMode ? (isJapanese ? "お薬の確認" : "약 확인") : undefined}
    >
      {/* video 요소는 카메라 연결 전부터 있어야 하고, 표정 모드와 알약 확인 모드에서 같은 요소를 써야
          카메라가 끊기지 않는다 (요소가 바뀌면 영상 연결이 사라짐). 그래서 두 모드 모두 같은 자리에 둔다.
          어두운 영상은 분석용 프레임과 마찬가지로 미리보기도 밝게 보정한다. */}
      <div className={pillMode ? styles.pillVideoBox : styles.cameraVideoLayer}>
        <video
          ref={videoRef}
          className={showVideo ? styles.cameraPreview : styles.hiddenVideo}
          style={showVideo && previewFilter !== 1 ? { filter: `brightness(${previewFilter})` } : undefined}
          muted
          playsInline
          aria-label={pillMode ? (isJapanese ? "お薬確認カメラのプレビュー" : "약 확인 카메라 미리보기") : isJapanese ? "表情観察カメラのプレビュー" : "표정 관찰 카메라 미리보기"}
        />
        {/* 알약은 이 네모 안만 본다 (lib/pill/zoom.ts GUIDE_FRACTION과 같은 크기) */}
        {pillMode && showVideo ? <div className={styles.pillGuide} aria-hidden="true" /> : null}
        {/* 개발 중: 기기에서 실제로 받은 카메라 해상도 (예: 아이패드에서 몇이 나오는지 확인용) */}
        {pillMode && showVideo && cameraSize && process.env.NODE_ENV !== "production" ? (
          <small className={styles.pillCameraSize}>{cameraSize.width}x{cameraSize.height}</small>
        ) : null}
      </div>

      {pillCheck ? (
        <PillCheckPanel
          language={language}
          group={pillGroup}
          takenIds={takenIds}
          phase={pill.phase}
          verdict={pill.verdict}
          cameraProblem={cameraProblem}
          needsCameraConsent={!cameraEnabled}
          onAllowCamera={() => setPillCameraAllowed(true)}
          onTaken={async (item, method) => {
            const ok = await pill.confirmTaken(item, method);
            if (ok) {
              setTakenIds((ids) => [...ids, item.id]);
              pillCheck.onTaken(item);
            }
            return ok;
          }}
          onClose={pillCheck.onClose}
          debugShow={pillCheck.debug ? pill.debugShow : undefined}
          evidence={pill.evidence}
          capsule={pill.capsule}
          onCapsuleAnswer={pill.answerCapsule}
          speak={pillCheck.speak}
        />
      ) : !loaded ? null : consent === "unknown" ? (
        <div className={styles.cameraText}>
          <span><i className={styles.cameraDotOff} aria-hidden="true" />{isJapanese ? "表情観察カメラを起動しますか？" : "표정 관찰 카메라를 켤까요?"}</span>
          <small>{isJapanese ? "表情の変化を医療スタッフが参考にします。映像は保存・送信しません。いつでも停止できます。" : "표정 변화를 의료진이 참고할 수 있도록 살펴봐요. 영상은 저장하거나 보내지 않아요. 언제든 끌 수 있어요."}</small>
          <button type="button" className={styles.cameraButton} onClick={turnOn}>{isJapanese ? "カメラを起動" : "카메라 켜기"}</button>
        </div>
      ) : consent === "off" ? (
        <div className={styles.cameraText}>
          <span><i className={styles.cameraDotOff} aria-hidden="true" />{isJapanese ? "表情観察カメラは停止中です" : "표정 관찰 카메라가 꺼져 있어요"}</span>
          <button type="button" className={styles.cameraButton} onClick={turnOn}>{isJapanese ? "再起動" : "다시 켜기"}</button>
        </div>
      ) : (
        <>
          <div className={styles.cameraText}>
            <span><i className={message?.active ? styles.cameraDotOn : styles.cameraDotOff} aria-hidden="true" />{message?.text}</span>
            {message?.hint ? <small>{message.hint}</small> : null}
          </div>
          <button type="button" className={styles.cameraOffButton} onClick={turnOff}>{isJapanese ? "停止" : "끄기"}</button>
          {speechAssistActive ? <small className={styles.cameraAssist}>{isJapanese ? `口元補助: ${mouthStatus === "speaking" ? "話しています" : mouthStatus === "noFace" ? "顔を合わせてください" : "発話を確認中"}` : `입모양 보조: ${mouthStatus === "speaking" ? "말하는 중" : mouthStatus === "noFace" ? "얼굴을 맞춰 주세요" : "말하기를 확인 중"}`}</small> : null}
        </>
      )}
    </div>
  );
}
