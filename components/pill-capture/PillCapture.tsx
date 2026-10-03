"use client";

import { useEffect, useRef, useState } from "react";
import { loadPillRecognizer, type PillRecognizer } from "../../lib/pill/recognizer";
import { guideRegion } from "../../lib/pill/zoom";
import styles from "./pill-capture.module.css";

// 개발용 촬영 화면 (/pill-capture). 시연 기기(아이패드 후면 카메라)로 실제 알약 사진을 찍어
// 노트북의 camera-model/pill-recognition/own_photos/<약 코드>/에 저장한다 → add_own_photos.py → v3 재학습.
// 찍을 때 지금 모델로 알약 위치(box)를 찾아 같이 저장한다 (못 찾으면 box 없이 저장, 학습에서는 빠짐).

const AUTO_INTERVAL_MS = 800;
const DEMO_CODES = ["K-045037", "K-004378"]; // 리리베아, 타이레놀 (시연 약)

interface ClassInfo {
  code: string;
  name: string;
}

interface LastShot {
  ok: boolean;
  message: string;
}

async function openCamera(): Promise<{ stream: MediaStream; camera: "rear" | "front" }> {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: "environment" }, ...size }, audio: false }), camera: "rear" };
  } catch {
    return { stream: await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", ...size }, audio: false }), camera: "front" };
  }
}

export function PillCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recognizerRef = useRef<PillRecognizer | null>(null);
  const busyRef = useRef(false);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [drug, setDrug] = useState(DEMO_CODES[0]!);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [camera, setCamera] = useState<"rear" | "front" | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [modelState, setModelState] = useState("모델 불러오는 중…");
  const [auto, setAuto] = useState(false);
  const [last, setLast] = useState<LastShot | null>(null);

  useEffect(() => {
    void fetch("/models/pill/classes.json").then(async (response) => setClasses((await response.json()) as ClassInfo[]));
    void fetch("/api/pill-capture").then(async (response) => {
      if (response.ok) setCounts(((await response.json()) as { counts: Record<string, number> }).counts);
      else setProblem("저장 API를 쓸 수 없어요. 개발 서버(npx -y pnpm@10 dev)로 열었는지 확인해 주세요.");
    });
    void loadPillRecognizer().then((loaded) => {
      if (loaded.kind === "ready") {
        recognizerRef.current = loaded.recognizer;
        setModelState(`모델 ${loaded.recognizer.modelVersion} (알약 위치 찾기용)`);
      } else {
        setModelState("모델을 불러오지 못해 알약 위치 없이 저장해요");
      }
    });
    return () => recognizerRef.current?.close();
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    openCamera()
      .then(async (opened) => {
        if (cancelled) return opened.stream.getTracks().forEach((track) => track.stop());
        stream = opened.stream;
        setCamera(opened.camera);
        const settings = stream.getVideoTracks()[0]?.getSettings();
        if (settings?.width && settings?.height) setSize({ width: settings.width, height: settings.height });
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
      })
      .catch((error: unknown) => setProblem(`카메라를 켤 수 없어요: ${String(error)}`));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function shoot() {
    const video = videoRef.current;
    if (!video || busyRef.current || !video.videoWidth) return;
    busyRef.current = true;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      const image = canvas.toDataURL("image/jpeg", 0.92);

      // 가운데 네모 안에서 지금 모델로 알약 위치를 찾는다 (약 종류는 고른 약으로 저장)
      let box: number[] | null = null;
      let model: { drugCode: string; confidence: number } | null = null;
      const recognizer = recognizerRef.current;
      if (recognizer) {
        const found = (await recognizer.detect(canvas, guideRegion(canvas.width, canvas.height))).filter((item) => item.box);
        const top = found.sort((a, b) => b.confidence - a.confidence)[0];
        if (top?.box) {
          box = top.box.map((value) => Math.round(value * 100_000) / 100_000);
          model = { drugCode: top.drugCode, confidence: Math.round(top.confidence * 1000) / 1000 };
        }
      }

      const response = await fetch("/api/pill-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drugCode: drug, image, box, model, camera, width: canvas.width, height: canvas.height }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const saved = (await response.json()) as { count: number };
      setCounts((current) => ({ ...current, [drug]: saved.count }));
      setLast({ ok: !!box, message: box ? `저장 (${saved.count}장) · 알약 위치 찾음${model ? ` · 모델은 ${model.drugCode} ${model.confidence}` : ""}` : `저장 (${saved.count}장) · 알약 위치 못 찾음 (학습에서 빠짐)` });
    } catch (error) {
      setLast({ ok: false, message: `저장 실패: ${String(error)}` });
    } finally {
      busyRef.current = false;
    }
  }

  // 연속 촬영: 각도·거리·앞뒤 면을 바꿔 가며 빠르게 많이
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void shoot(), AUTO_INTERVAL_MS);
    return () => clearInterval(timer);
  });

  const ordered = [...classes].sort((a, b) => Number(!DEMO_CODES.includes(a.code)) - Number(!DEMO_CODES.includes(b.code)));

  return (
    <main className={styles.page}>
      <h1>알약 학습 사진 촬영 (개발용)</h1>
      <p className={styles.note}>
        사진은 이 개발 서버 컴퓨터의 <code>camera-model/pill-recognition/own_photos/</code>에만 저장돼요 (레포에 올라가지 않음).
        한 장에 한 알, 가운데 네모 안에. 앞면·뒷면, 각도, 거리(20~40cm), 손바닥·책상 위, 밝은 곳·어두운 곳을 섞어 약마다 100장 이상.
      </p>
      {problem ? <p className={styles.problem}>{problem}</p> : null}
      <div className={styles.drugs}>
        {ordered.map((item) => (
          <button key={item.code} type="button" className={item.code === drug ? styles.selected : undefined} onClick={() => setDrug(item.code)}>
            {item.name}
            <small>{counts[item.code] ?? 0}장</small>
          </button>
        ))}
      </div>
      <div className={styles.videoBox}>
        <video ref={videoRef} muted playsInline className={camera === "front" ? styles.mirrored : undefined} />
        <div className={styles.guide} aria-hidden="true" />
        <small className={styles.info}>{camera === "rear" ? "후면" : camera === "front" ? "전면" : ""} {size ? `${size.width}x${size.height}` : ""}</small>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => void shoot()} disabled={auto}>찍기</button>
        <button type="button" onClick={() => setAuto((value) => !value)} className={auto ? styles.recording : undefined}>
          {auto ? "연속 촬영 멈추기" : "연속 촬영 (0.8초마다)"}
        </button>
      </div>
      <p className={styles.status}>{modelState}</p>
      {last ? <p className={last.ok ? styles.ok : styles.problem}>{last.message}</p> : null}
    </main>
  );
}
