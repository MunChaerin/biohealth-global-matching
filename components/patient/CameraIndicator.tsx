"use client";

import { useEffect, useState } from "react";
import { DEMO_PATIENT_ID, type CameraStatus } from "../../lib/camera/report";
import type { ChatLanguage } from "../../lib/chatbot/types";
import { sendReport, useFaceExpression } from "./useFaceExpression";
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
  permissionDenied: { text: "카메라 권한이 꺼져 있어 표정 관찰을 하지 않아요", active: false },
  unavailable: { text: "카메라를 사용할 수 없어 표정 관찰을 하지 않아요", active: false },
  },
  ja: {
    starting: { text: "表情観察カメラを起動しています", active: false },
    calibrating: { text: "表情観察カメラが作動中です", hint: "普段の表情でしばらくお待ちください", active: true },
    measuring: { text: "表情観察カメラが作動中です", active: true },
    noFace: { text: "表情観察カメラが作動中です", hint: "顔が画面に入るようにしてください", active: true },
    permissionDenied: { text: "カメラの権限がないため観察していません", active: false },
    unavailable: { text: "カメラを使用できないため観察していません", active: false },
  },
};

/**
 * 환자 화면의 표정 관찰 카메라. 처음에는 안내와 함께 켤지 묻고, 켜면 작은 미리보기와 끄기 버튼을 보여준다.
 * 끄면 카메라·분석·전송이 모두 멈추고, 의료진 화면에는 "환자가 카메라를 끔"만 한 번 알린다.
 * 영상은 브라우저 안에서만 쓰고 저장·전송하지 않는다.
 */
export function CameraIndicator({ language = "ko" }: { language?: ChatLanguage }) {
  const [consent, setConsent] = useState<Consent>("unknown");
  const [loaded, setLoaded] = useState(false);
  const { videoRef, status, previewFilter } = useFaceExpression(consent === "on");

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
    void sendReport({ patientId: DEMO_PATIENT_ID, measuredAt: new Date().toISOString(), status: "off" });
  }

  const isJapanese = language === "ja";
  const message = status === "off" ? null : messages[language][status];
  const live = consent === "on" && !!message?.active;

  return (
    <div className={`${styles.cameraIndicator} ${live ? styles.cameraLive : ""}`} role="status">
      {/* video 요소는 카메라 연결 전부터 있어야 해서 항상 그리고, 작동 중일 때만 카드 전체에 보이게 한다.
          어두운 영상은 분석용 프레임과 마찬가지로 미리보기도 밝게 보정한다. */}
      <video
        ref={videoRef}
        className={live ? styles.cameraPreview : styles.hiddenVideo}
        style={live && previewFilter !== 1 ? { filter: `brightness(${previewFilter})` } : undefined}
        muted
        playsInline
        aria-label={isJapanese ? "表情観察カメラのプレビュー" : "표정 관찰 카메라 미리보기"}
      />

      {!loaded ? null : consent === "unknown" ? (
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
        </>
      )}
    </div>
  );
}
