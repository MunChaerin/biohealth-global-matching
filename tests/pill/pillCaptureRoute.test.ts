// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/api/pill-capture/route";

const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
let root: string;

function post(body: unknown) {
  return POST(new Request("http://localhost/api/pill-capture", { method: "POST", body: JSON.stringify(body) }));
}

describe("/api/pill-capture (개발용 학습 사진 저장)", () => {
  beforeEach(async () => {
    // 레포의 own_photos 대신 임시 폴더에 저장되게 한다
    root = await mkdtemp(path.join(os.tmpdir(), "pill-capture-"));
    await mkdir(path.join(root, "public", "models", "pill"), { recursive: true });
    await writeFile(path.join(root, "public", "models", "pill", "classes.json"), JSON.stringify([{ code: "K-045037" }, { code: "K-004378" }]));
    vi.spyOn(process, "cwd").mockReturnValue(root);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it("고른 약 폴더에 사진과 위치 정보(json)를 저장하고 장수를 센다", async () => {
    const response = await post({ drugCode: "K-045037", image: jpeg, box: [0.4, 0.4, 0.1, 0.05], model: { drugCode: "K-045037", confidence: 0.5 }, camera: "rear", width: 1920, height: 1080 });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { count: number }).count).toBe(1);
    const dir = path.join(root, "camera-model", "pill-recognition", "own_photos", "K-045037");
    const files = (await readdir(dir)).sort();
    expect(files.map((name) => path.extname(name))).toEqual([".jpg", ".json"]);
    const meta = JSON.parse(await readFile(path.join(dir, files[1]!), "utf8"));
    expect(meta).toMatchObject({ drugCode: "K-045037", box: [0.4, 0.4, 0.1, 0.05], camera: "rear", width: 1920, source: "web_capture" });
    expect(((await (await GET()).json()) as { counts: Record<string, number> }).counts).toEqual({ "K-045037": 1, "K-004378": 0 });
  });

  it("10종 밖의 약 코드, JPEG가 아닌 사진, 잘못된 위치는 거부한다", async () => {
    expect((await post({ drugCode: "../etc", image: jpeg })).status).toBe(400);
    expect((await post({ drugCode: "K-045037", image: "data:image/png;base64,AAAA" })).status).toBe(400);
    expect((await post({ drugCode: "K-045037", image: jpeg, box: [0, 0, 2, 1] })).status).toBe(400);
  });

  it("배포(production)에서는 항상 막는다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CAMERA_DEMO_MODE", "true");
    expect((await post({ drugCode: "K-045037", image: jpeg })).status).toBe(404);
    expect((await GET()).status).toBe(404);
  });
});
