import styles from "./patient-chat.module.css";
import type { ChatLanguage } from "../../lib/chatbot/types";

export function SafetyNotice({ language = "ko" }: { language?: ChatLanguage }) {
  const isJapanese = language === "ja";
  return (
    <section className={styles.safetyNotice} role="alert" aria-live="assertive">
      <strong>{isJapanese ? "医療スタッフに接続しています。" : "의료진에게 연결하고 있습니다."}</strong>
      <p>{isJapanese ? "通常の質問を一時停止しました。近くの医療スタッフまたはご家族の案内に従ってください。" : "일반 질문을 잠시 멈췄습니다. 가까운 의료진이나 보호자의 안내를 따라 주세요."}</p>
    </section>
  );
}
