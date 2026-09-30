"use client";

import type { CameraStatus } from "../../lib/camera/report";
import { useFaceExpression } from "./useFaceExpression";
import styles from "./patient-chat.module.css";

const messages: Record<CameraStatus, { text: string; hint?: string; active: boolean }> = {
  starting: { text: "표정 관찰 카메라를 켜고 있어요", active: false },
  calibrating: { text: "표정 관찰 카메라 작동 중", hint: "평소 표정으로 잠시 계셔 주세요", active: true },
  measuring: { text: "표정 관찰 카메라 작동 중", active: true },
  noFace: { text: "표정 관찰 카메라 작동 중", hint: "얼굴이 화면 안에 들어오게 해 주세요", active: true },
  permissionDenied: { text: "카메라 권한이 꺼져 있어 표정 관찰을 하지 않아요", active: false },
  unavailable: { text: "카메라를 사용할 수 없어 표정 관찰을 하지 않아요", active: false },
};

/**
 * 환자 화면에서 웹캠을 계속 켜 두고, 작은 미리보기와 작동 표시를 보여준다 (버튼 없음).
 * 미리보기는 얼굴이 화면 안에 들어오는지 확인하고, 촬영 중임을 알리기 위한 것이다.
 * 영상은 브라우저 안에서만 쓰고 저장·전송하지 않는다.
 */
export function CameraIndicator() {
  const { videoRef, status } = useFaceExpression();
  const { text, hint, active } = messages[status];

  return (
    <div className={styles.cameraIndicator} role="status">
      {/* video 요소는 카메라 연결 전부터 있어야 해서 항상 그리고, 작동 중일 때만 보이게 한다 */}
      <video
        ref={videoRef}
        className={active ? styles.cameraPreview : styles.hiddenVideo}
        muted
        playsInline
        aria-label="표정 관찰 카메라 미리보기"
      />
      <div className={styles.cameraText}>
        <span>
          <i className={active ? styles.cameraDotOn : styles.cameraDotOff} aria-hidden="true" />
          {text}
        </span>
        {hint ? <small>{hint}</small> : null}
      </div>
    </div>
  );
}
