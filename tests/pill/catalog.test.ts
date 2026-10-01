import { describe, expect, it } from "vitest";
import { pillName, withParticle } from "../../lib/pill/catalog";

describe("pillName", () => {
  it("복약 일정의 약과 학습한 다른 약의 이름을 돌려준다", () => {
    expect(pillName("K-045037", "ko")).toBe("리리베아캡슐 50mg");
    expect(pillName("K-011354", "ko")).toBe("애드빌정");
    expect(pillName("K-011354", "ja")).toBe("アドビル錠");
    expect(pillName("K-999999", "ko")).toBe("다른 약");
  });
});

describe("withParticle", () => {
  it("받침에 맞춰 조사를 붙인다", () => {
    expect(withParticle("애드빌정", "이에요", "예요")).toBe("애드빌정이에요");
    expect(withParticle("아로나민골드", "이에요", "예요")).toBe("아로나민골드예요");
    expect(withParticle("타이레놀정 500mg", "을", "를")).toBe("타이레놀정 500mg을"); // 밀리그램
    expect(withParticle("이지엔6", "이에요", "예요")).toBe("이지엔6이에요"); // 육
    expect(withParticle("비타민B2", "이에요", "예요")).toBe("비타민B2예요"); // 이
  });
});
