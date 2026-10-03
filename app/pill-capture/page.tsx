import { notFound } from "next/navigation";
import { PillCapture } from "../../components/pill-capture/PillCapture";

// 개발용 알약 학습 사진 촬영 (시연 기기 후면 카메라로 v3 재학습 데이터 모으기). 배포에서는 열리지 않는다.
export const dynamic = "force-dynamic";

export default function PillCapturePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PillCapture />;
}
