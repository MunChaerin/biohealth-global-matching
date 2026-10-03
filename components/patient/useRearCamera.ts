"use client";

import { useEffect, useState } from "react";

// 알약 확인용 후면 카메라. 전면 카메라(표정 관찰)는 고정 초점 + 초광각인 기기가 많아(예: 아이패드 9세대)
// 가까이 대면 흐리고 멀면 작아서 알약 각인을 못 읽었다. 후면 카메라는 자동 초점이라 알약을 들고 비추기 좋다.
// 한 번에 카메라 하나만 쓴다: 후면을 쓰는 동안 전면(표정 관찰)은 꺼 두고, 약 확인이 끝나면 후면을 끄고 전면을 다시 켠다.
// 후면 카메라가 없는 기기(노트북)는 전면 카메라로 대신한다.

export type RearCameraState =
  | "idle" // 약 확인 중이 아님
  | "waiting" // 전면 카메라가 완전히 꺼지기를 기다리는 중 (iOS는 카메라를 한 번에 하나만 씀)
  | "trying" // 후면 카메라를 켜는 중
  | "rear" // 후면 카메라 사용 중
  | "unavailable"; // 후면 카메라가 없거나 켤 수 없음 -> 전면으로 대신

const REAR_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};
const RELEASE_DELAY_MS = 200; // 전면을 끈 뒤 iOS가 카메라를 놓을 시간

// 후면 카메라가 없는 기기에서 약 확인 때마다 전면 카메라를 껐다 켜지 않도록, 이 화면을 연 동안 기억한다.
let rearKnownUnavailable = false;

/** 테스트용: 기억한 결과를 지운다. */
export function resetRearCameraMemory() {
  rearKnownUnavailable = false;
}

/** 후면 카메라가 없다고 이미 알고 있는지 (그러면 약 확인 때 전면을 끄지 않는다) */
export function rearCameraKnownUnavailable() {
  return rearKnownUnavailable;
}

/**
 * active: 약 확인 중, frontReleased: 전면 카메라 요청·스트림이 모두 끝남.
 * 전면이 완전히 꺼진 뒤에만 후면을 요청하고, 후면 트랙이 우리가 끄지 않았는데 끝나면(iOS가 종료) 한 번 다시 요청한다.
 */
export function useRearCamera(active: boolean, video: HTMLVideoElement | null, frontReleased: boolean) {
  const [state, setState] = useState<RearCameraState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const known = active && rearKnownUnavailable;
  const ready = active && !rearKnownUnavailable && frontReleased;

  useEffect(() => {
    if (!active) setState("idle");
    else if (known) setState("unavailable");
    else if (!ready) setState("waiting");
  }, [active, known, ready]);

  // 후면 카메라 켜기 / 끄기 (전면이 완전히 꺼진 뒤에만)
  useEffect(() => {
    if (!ready) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    let cancelled = false;
    let opened: MediaStream | null = null;

    function stopOpened() {
      const current = opened;
      opened = null;
      current?.getTracks().forEach((track) => track.stop());
    }

    async function open(retry: boolean) {
      setState("trying");
      let result: MediaStream;
      try {
        result = await navigator.mediaDevices.getUserMedia(REAR_CONSTRAINTS);
      } catch (error) {
        if (cancelled) return;
        // 권한 거부는 기기 문제가 아니므로 기억하지 않는다 (전면 카메라 쪽에서 권한 안내)
        if (!retry && !(error instanceof DOMException && error.name === "NotAllowedError")) rearKnownUnavailable = true;
        console.info("[카메라] 후면 카메라를 쓸 수 없어 전면 카메라로 확인합니다.", error);
        setState("unavailable");
        return;
      }
      if (cancelled) {
        result.getTracks().forEach((track) => track.stop());
        return;
      }
      opened = result;
      const track = result.getVideoTracks?.()[0];
      // 우리가 끄지 않았는데 트랙이 끝나면(iOS가 다른 카메라 요청 때문에 종료 등) 한 번 다시 요청, 또 끝나면 전면으로
      track?.addEventListener?.("ended", () => {
        if (cancelled || opened !== result) return;
        console.warn(`[카메라] 후면 카메라 트랙이 종료됨${retry ? " (다시 요청 후에도) -> 전면으로 대신" : " -> 한 번 다시 요청"}`);
        stopOpened();
        setStream(null);
        if (retry) setState("unavailable");
        else void open(true);
      });
      const settings = track?.getSettings?.();
      const nextSize = settings?.width && settings?.height ? { width: settings.width, height: settings.height } : null;
      if (nextSize) console.info(`[카메라] 알약 확인: 후면 카메라 ${nextSize.width}x${nextSize.height}`);
      setSize(nextSize);
      setStream(result);
      setState("rear");
    }

    // 전면을 끈 직후 바로 요청하지 않고 잠깐 기다린다
    const timer = setTimeout(() => void open(false), RELEASE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopOpened();
      setStream(null);
      setSize(null);
    };
  }, [ready]);

  // 같은 video 요소에 후면 영상을 연결 (전면 카메라는 이때 꺼져 있음)
  useEffect(() => {
    if (!stream || !video) return;
    video.srcObject = stream;
    void video.play().catch((error: unknown) => console.error("rear camera play error", error));
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream, video]);

  return { state, size };
}
