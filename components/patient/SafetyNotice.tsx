import styles from "./patient-chat.module.css";

export function SafetyNotice() {
  return (
    <section className={styles.safetyNotice} role="alert" aria-live="assertive">
      <strong>의료진에게 연결하고 있습니다.</strong>
      <p>일반 질문을 잠시 멈췄습니다. 가까운 의료진이나 보호자의 안내를 따라 주세요.</p>
    </section>
  );
}
