"use client";

import type { CameraStatus } from "../../lib/camera/report";
import { useFaceExpression } from "./useFaceExpression";
import styles from "./patient-chat.module.css";

const messages: Record<CameraStatus, { text: string; active: boolean }> = {
  starting: { text: "표정 관찰 카메라를 켜고 있어요", active: false },
  calibrating: { text: "표정 관찰 카메라 작동 중", active: true },
  measuring: { text: "표정 관찰 카메라 작동 중", active: true },
  noFace: { text: "표정 관찰 카메라 작동 중", active: true },
  permissionDenied: { text: "카메라 권한이 꺼져 있어 표정 관찰을 하지 않아요", active: false },
  unavailable: { text: "카메라를 사용할 수 없어 표정 관찰을 하지 않아요", active: false },
};

/** 환자 화면에서 웹캠을 계속 켜 두고, 작동 중이라는 작은 표시만 보여준다 (미리보기 없음). */
export function CameraIndicator() {
  const { videoRef, status } = useFaceExpression();
  const { text, active } = messages[status];

  return (
    <div className={styles.cameraIndicator} role="status">
      <i className={active ? styles.cameraDotOn : styles.cameraDotOff} aria-hidden="true" />
      <span>{text}</span>
      {/* 분석용 영상. 화면에는 보이지 않고 저장·전송하지 않는다. */}
      <video ref={videoRef} className={styles.hiddenVideo} muted playsInline aria-hidden="true" />
    </div>
  );
}
