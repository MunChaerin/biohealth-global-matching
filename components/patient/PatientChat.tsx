"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CameraIndicator } from "./CameraIndicator";
import { useTodayMedication } from "./useTodayMedication";
import type { MedicationItem } from "../../lib/medication/schedule";
import { clockTime, dueGroup, openedKey } from "../../lib/medication/autoOpen";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { SafetyNotice } from "./SafetyNotice";
import { usePatientChat } from "./usePatientChat";
import { useSpeech } from "./useSpeech";
import type { ChatLanguage } from "../../lib/chatbot/types";
import { getPatientPersona } from "../../lib/patient/personas";
import { getChatSessionId } from "../../lib/chatbot/soapDraft";
import { createConversationObservation } from "../../lib/chatbot/observation";
import styles from "./patient-chat.module.css";

function localizeInitialMessage(text: string, language: ChatLanguage): string {
  if (language === "ja" && text === "오늘 가장 불편한 점은 무엇인가요?") return "今日、いちばんつらいことは何ですか？";
  if (language === "ko" && text === "今日、いちばんつらいことは何ですか？") return "오늘 가장 불편한 점은 무엇인가요?";
  return text;
}

const AUTO_OPEN_CHECK_MS = 15_000;
const AUTO_OPENED_KEY = "carelink.pillAutoOpened"; // 이 기기에서 오늘 자동으로 연 복용 시간 ("환자|날짜|시간|자동 열림 시각")

function readAutoOpened(patientId: string): string[] {
  try {
    const all = JSON.parse(window.localStorage.getItem(AUTO_OPENED_KEY) ?? "[]") as string[];
    return all.filter((key) => key.startsWith(`${patientId}|`)).map((key) => key.slice(patientId.length + 1));
  } catch {
    return [];
  }
}

function markAutoOpened(patientId: string, date: string, time: string, openAt: string) {
  try {
    const all = (JSON.parse(window.localStorage.getItem(AUTO_OPENED_KEY) ?? "[]") as string[]).filter((key) => key.includes(`|${date}|`)); // 지난 날짜는 지움
    window.localStorage.setItem(AUTO_OPENED_KEY, JSON.stringify([...new Set([...all, `${patientId}|${openedKey(date, time, openAt)}`])]));
  } catch {
    // 저장이 안 되면 이번 화면에서만 (다시 열릴 수 있음)
  }
}

export function PatientChat() {
  const [personaId, setPersonaId] = useState<string | null>(null);
  useEffect(() => {
    setPersonaId(new URLSearchParams(window.location.search).get("personaId"));
  }, []);
  const persona = getPatientPersona(personaId);
  const { context, error, isComplete, isLoading, safetyHold, finishSession, sendMessage, setLanguage } = usePatientChat(persona);
  const speech = useSpeech(context.language ?? "ko");
  const endRef = useRef<HTMLDivElement>(null);
  const [callStatus, setCallStatus] = useState<"requested" | "acknowledged" | null>(null);
  const [callAcknowledged, setCallAcknowledged] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const medication = useTodayMedication(persona.id);
  const [pillCheckGroup, setPillCheckGroup] = useState<MedicationItem[] | null>(null);
  const [pillDebug, setPillDebug] = useState(false);
  const today = medication.today;
  // 시간이 되면(의료진이 정한 자동 열림 시각) 약 확인을 저절로 연다. 같은 복용 시간은 하루에 한 번만 (닫으면 다시 열지 않음)
  useEffect(() => {
    if (!today || pillCheckGroup) return;
    const check = () => {
      const opened = readAutoOpened(persona.id);
      const now = clockTime();
      const due = dueGroup(today, now, new Set(opened));
      if (process.env.NODE_ENV !== "production") {
        const plan = today.reminders.map((reminder) => `${reminder.time} 복용 -> ${reminder.openAt}${opened.includes(openedKey(today.date, reminder.time, reminder.openAt)) ? " (오늘 열었음)" : ""}`).join(", ");
        console.debug(`[약 확인 자동 열림] 지금 ${now} | ${plan}${due ? ` | ${due.time} 복용 약을 엽니다` : ""}`);
      }
      if (!due) return;
      markAutoOpened(persona.id, today.date, due.time, due.openAt);
      setPillCheckGroup(due.items);
    };
    check();
    const timer = setInterval(check, AUTO_OPEN_CHECK_MS);
    return () => clearInterval(timer);
  }, [today, pillCheckGroup, persona.id]);
  useEffect(() => {
    // 알약 인식 모델 없이 화면 흐름을 확인하는 개발용 모드 (?pillDebug=1)
    setPillDebug(process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("pillDebug") === "1");
  }, []);
  const language = context.language ?? "ko";
  const isJapanese = language === "ja";
  const copy = isJapanese
    ? { kicker: "今日のケア対話", title: `${persona.japaneseName}さん、おはようございます。`, subtitle: persona.japaneseGreeting, notice: "日本語でお話ししています。音声入力も使えます。", assistant: "こころのケア友だち", listening: "一緒に聞いています", quick: "今の気持ちに近い言葉を選んでください。", soap: "SOAPの下書きを作成しました", soapHelp: "医療スタッフが確認して最終判断します。", placeholder: "つらいことをゆっくり話してください。", patient: "患者画面", clinician: "医療スタッフ画面", review: "医療スタッフの確認をサポート", language: "言語 ·", enlarge: "文字を大きく", voice: "◖ 音声で聞く", loading: "回答を確認しています...", assist: "◌　発音が不明瞭なときは", stt: "STT音声入力補助", assistEnd: "が一緒に働きます。", moodLabel: "今日の対話観察", moodTitle: "安心した表現が多くありました", tired: "少し疲れ", calm: "安心", moodHint: "最近の対話で観察された表現をまとめた参考情報です。", help: "お手伝いが必要ですか？", helpHint: "担当の医療スタッフにすぐ知らせます。", call: "医療スタッフを呼ぶ", called: "依頼を伝えました", callConfirm: "担当の医療スタッフに助けを求めました。", medicine: "次のお薬", medicineName: "午前の薬", medicineTime: "服薬予定を確認してください", medicineHint: "服薬情報は医療スタッフの確認用です。", taken: "飲みました", takenDone: "✓ 服薬を確認", planLabel: "今日の説明", planTitle: "医療スタッフが分かりやすく説明します", planText: `${persona.japaneseName}さん、今日の体調について医療スタッフが確認します。`, listen: "音声で聞く　›", soapLink: "医療スタッフ画面で確認 ›", footer: "ⓘ 健康状態の表示はケアのための参考情報であり、診断や緊急判断に代わるものではありません。" }
    : { kicker: "오늘의 돌봄 대화", title: `${persona.name} 어르신, 좋은 아침이에요.`, subtitle: persona.greeting, notice: "한국어로 대화하고 있어요. 음성 입력도 사용할 수 있어요.", assistant: "마음 돌봄 친구", listening: "함께 듣고 있어요", quick: "지금 마음에 가까운 말을 골라 보세요.", soap: "SOAP 초안을 작성했어요", soapHelp: "의료진이 확인한 뒤 최종 판단합니다.", placeholder: "불편한 점을 편하게 말씀해 주세요.", patient: "환자 화면", clinician: "의료진 화면", review: "의료진 검토 보조", language: "언어 ·", enlarge: "글자 크게", voice: "◖ 음성으로 듣기", loading: "답변을 확인하고 있어요...", assist: "◌　발음이 불분명할 때는", stt: "STT 음성 입력 보조", assistEnd: "가 함께 작동해요.", moodLabel: "오늘의 대화 관찰", moodTitle: "대화 관찰을 준비하고 있어요", tired: "확인 중", calm: "참고", moodHint: `${persona.summary}. 대화와 센서 정보가 쌓이면 갱신됩니다.`, help: "도움이 필요하세요?", helpHint: "담당 의료진에게 바로 알려드려요.", call: "의료진 부르기", called: "요청을 알렸어요", callConfirm: "담당 의료진에게 도움 요청을 알렸어요.", medicine: "복용 약물", medicineName: persona.medications, medicineTime: `${persona.age}세 · ${persona.room}`, medicineHint: persona.symptoms, taken: "복용했어요", takenDone: "✓ 복용 확인", planLabel: "오늘의 설명", planTitle: "의료진이 쉽게 알려드려요", planText: `${persona.name} 어르신, 오늘 상태를 의료진이 확인하고 쉬운 설명으로 알려드릴게요.`, listen: "음성으로 듣기　›", soapLink: "의료진 화면에서 확인 ›", footer: "ⓘ 건강 상태 표시는 돌봄을 돕기 위한 참고 정보이며, 진단이나 응급 판단을 대신하지 않습니다." };
  const replies = isJapanese ? persona.japaneseQuickReplies : persona.quickReplies;
  const observation = createConversationObservation(context);
  const localizedObservation = isJapanese
    ? {
        title: observation.title === "대화 관찰을 준비하고 있어요" ? "会話の観察を準備しています" : observation.title === "안정적인 표현이 늘고 있어요" ? "安心した表現が増えています" : observation.title === "불편감 표현을 확인해 주세요" ? "不快感の表現を確認してください" : "いくつかの表現が観察されています",
        detail: observation.evidence === "환자 발화 없음" ? "会話が始まると観察内容を表示します。" : observation.detail.includes("불편감") ? "不快感や心配に関する表現がありました。" : "現在の会話では明らかな危険表現は確認されていません。",
      }
    : { title: observation.title, detail: observation.detail };

  useEffect(() => {
    const update = async () => {
      try {
        const [callResponse, explanationResponse] = await Promise.all([
          fetch(`/api/care/call?patientId=${persona.id}`, { cache: "no-store" }),
          fetch(`/api/care/explanation?sessionId=${getChatSessionId(persona.id)}`, { cache: "no-store" }),
        ]);
        if (callResponse?.ok) {
          const status = ((await callResponse.json()) as { call?: { status: "requested" | "acknowledged" } }).call?.status ?? null;
          if (status === "acknowledged") {
            setCallStatus(null);
            setCallAcknowledged(true);
          } else {
            setCallStatus(status);
          }
        }
        if (explanationResponse?.ok) setExplanation(((await explanationResponse.json()) as { explanation?: { text: string } }).explanation?.text ?? null);
      } catch {
        // 케어 상태 조회가 잠시 실패해도 대화 화면은 계속 사용할 수 있다.
      }
    };
    const interval = window.setInterval(() => void update(), 1500);
    return () => window.clearInterval(interval);
  }, [persona.id]);

  async function callClinician() {
    const response = await fetch("/api/care/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: persona.id, sessionId: context.sessionId }) });
    if (response.ok) {
      setCallStatus("requested");
      setCallAcknowledged(false);
      try { window.localStorage.setItem("carelink.careCall", JSON.stringify({ patientId: persona.id, status: "requested", at: Date.now() })); } catch { /* 서버 동기화로 동작 */ }
    }
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [context.messages, isLoading]);

  async function handleSend(text: string) {
    speech.stopListening();
    const output = await sendMessage(text);
    if (output?.patientReply) speech.speak(output.patientReply);
  }

  return (
    <main className={`${styles.pageShell} ${largeText ? styles.largeText : ""}`}>
      <header className={styles.siteHeader}>
        <Link className={styles.brand} href="/patient"><span className={styles.brandMark}>C</span><span><strong>CareLink</strong><small>돌봄을 더 가까이</small></span></Link>
        <nav className={styles.roleNav} aria-label="역할 화면 전환"><Link className={styles.roleActive} href="/patient">{copy.patient}</Link><Link href="/clinician">{copy.clinician}</Link></nav>
        <span className={styles.headerStatus}>✓ {copy.review}</span>
      </header>

      <section className={styles.patientWelcome}>
        <div><p className={styles.sectionKicker}>{copy.kicker}</p><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
        <div className={styles.patientTools}><div className={styles.languageSwitch} aria-label="언어 선택"><span>{copy.language}</span><button type="button" className={language === "ko" ? styles.selectedLanguage : ""} onClick={() => setLanguage("ko" as ChatLanguage)} aria-pressed={language === "ko"}>한국어</button><button type="button" className={language === "ja" ? styles.selectedLanguage : ""} onClick={() => setLanguage("ja" as ChatLanguage)} aria-pressed={language === "ja"}>日本語</button></div><button type="button" onClick={() => setLargeText((value) => !value)} aria-pressed={largeText}>{largeText ? (isJapanese ? "文字を戻す" : "글자 작게") : copy.enlarge}</button></div>
      </section>

      <div className={styles.notice}><span>i</span><p>{copy.notice}</p></div>

      <div className={styles.patientLayout}>
        <section className={styles.conversationCard} aria-label="환자용 건강 대화">
          <div className={styles.conversationHead}><div className={styles.assistantIdentity}><span className={styles.assistantDot}>✦</span><div><b>{copy.assistant}</b><small><i /> {copy.listening}</small></div></div><span className={styles.voiceLabel}>{copy.voice}</span></div>
          <section className={styles.messages} aria-live="polite" aria-busy={isLoading}>
            {context.messages.map((item, index) => <ChatMessage key={`${item.createdAt}-${index}`} message={{ ...item, text: localizeInitialMessage(item.text, language) }} language={language} canSpeak={speech.synthesisSupported} isSpeaking={speech.isSpeaking} onSpeak={speech.speak} onStopSpeaking={speech.stopSpeaking} />)}
            {isLoading ? <p className={styles.loading}>{copy.loading}</p> : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {safetyHold ? <SafetyNotice language={language} /> : null}<div ref={endRef} />
          </section>
          <div className={styles.replyArea}><p>{copy.quick}</p><div className={styles.quickReplies}>{replies.map((reply) => <button type="button" key={reply} onClick={() => void handleSend(reply)} disabled={isLoading || safetyHold || isComplete}>{reply}　›</button>)}</div><ChatInput language={language} disabled={safetyHold || isComplete} isLoading={isLoading} onSend={handleSend} isListening={speech.isListening} recognitionSupported={speech.recognitionSupported} speechError={speech.speechError} onStartListening={speech.startListening} onStopListening={speech.stopListening} placeholder={copy.placeholder} onFinish={finishSession} finishDisabled={isComplete} /></div>
          {isComplete ? <div className={styles.soapReady} role="status"><strong>{copy.soap}</strong><span>{copy.soapHelp}</span><button type="button" onClick={() => window.location.assign("/clinician")}>{copy.soapLink}</button></div> : null}
          <div className={styles.assistStrip}>{copy.assist} <b>{copy.stt}</b>{copy.assistEnd}</div>
        </section>

        <aside className={styles.patientSide}>
          <section className={styles.moodCard}><div className={styles.cardHeading}><div><p>{copy.moodLabel}</p><h2>{localizedObservation.title}</h2></div><span className={styles.moodFace}>☺</span></div><div className={styles.moodMeter}><span style={{ width: `${observation.score}%` }} /><i /></div><div className={styles.moodLabels}><span>{copy.tired}</span><b>{copy.calm}</b></div><p className={styles.subtle}>{localizedObservation.detail}</p></section>
          <section className={styles.careCallCard}><span className={styles.callIcon}>⌁</span><div><p>{copy.help}</p><small>{callStatus ? copy.callConfirm : callAcknowledged ? (isJapanese ? "医療スタッフが確認しました。もう一度必要なときは押してください。" : "의료진이 확인했어요. 다시 도움이 필요하면 눌러 주세요.") : copy.helpHint}</small></div><button type="button" className={callStatus ? styles.called : ""} onClick={() => void callClinician()} disabled={callStatus === "requested"}>{callStatus ? copy.called : copy.call}</button>{callAcknowledged ? <small className={styles.callConfirm}>{isJapanese ? "医療スタッフが確認しました。ボタンをもう一度使えます。" : "의료진이 확인했어요. 버튼을 다시 사용할 수 있어요."}</small> : null}</section>
          <CameraIndicator
            language={language}
            patientId={persona.id}
            speechAssistActive={speech.isListening}
            pillCheck={pillCheckGroup ? {
              medications: pillCheckGroup,
              debug: pillDebug,
              onClose: () => setPillCheckGroup(null),
              onTaken: () => void medication.refresh(),
              speak: speech.speak,
            } : null}
          />
        </aside>
      </div>

      <div className={styles.bottomGrid}><section className={styles.medicineCard}>{(() => {
        const next = medication.today?.next ?? null;
        const group = medication.today?.nextGroup ?? [];
        const allTaken = !!medication.today && medication.today.items.length > 0 && !next;
        // 같은 시간에 먹을 약을 한 줄로 (예: 리리베아캡슐 50mg 1캡슐 · 타이레놀정 500mg 1알)
        const nextName = group.length ? group.map((item) => `${isJapanese ? item.japaneseName : item.name} ${isJapanese ? item.japaneseDose : item.dose}`).join(" · ") : null;
        return <>
          <div className={styles.cardHeading}><div><p>{copy.medicine}</p>
            <h2>{nextName ? nextName : allTaken ? (isJapanese ? "今日のお薬はすべて飲みました" : "오늘 약을 모두 드셨어요") : copy.medicineName}</h2>
            <small>{next ? `${next.time} · ${group.length > 1 ? (isJapanese ? `${group.length}錠を1錠ずつ確認します` : `${group.length}알을 한 알씩 확인해요`) : isJapanese ? next.japaneseAppearance : next.appearance}` : medication.failed ? (isJapanese ? "服薬予定を読み込めませんでした" : "복약 일정을 불러오지 못했어요") : copy.medicineTime}</small>
          </div><span className={styles.medicineIcon}>＋</span></div>
          <div className={styles.medicineAction}><span>{next ? (isJapanese ? "飲む前にカメラでお薬を確認します。" : "드시기 전에 카메라로 약을 확인해요.") : copy.medicineHint}</span>
            {allTaken
              ? <button type="button" className={styles.completed} disabled>{copy.takenDone}</button>
              : <button type="button" onClick={() => {
                  if (!group.length) return;
                  // 직접 열었으면 그 시간에는 (지금 정해진 시각으로는) 자동으로 다시 열지 않음
                  const reminder = medication.today?.reminders.find((item) => item.time === group[0]!.time);
                  if (medication.today && reminder) markAutoOpened(persona.id, medication.today.date, reminder.time, reminder.openAt);
                  setPillCheckGroup(group);
                }} disabled={!group.length || !!pillCheckGroup}>{copy.taken}</button>}
          </div>
        </>;
      })()}</section><section className={styles.easyPlanCard}><div className={styles.planTitle}><span>♡</span><div><p>{copy.planLabel}</p><h2>{explanation ? (isJapanese ? "医療スタッフからの説明" : "의료진이 보낸 설명") : copy.planTitle}</h2></div></div><p>{explanation ?? copy.planText}</p><button type="button" onClick={() => speech.speak(explanation ?? copy.planText)}>{copy.listen}</button></section></div>
      <p className={styles.footnote}>{copy.footer}</p>
    </main>
  );
}
