import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "../middleware";

function request(authorization?: string) {
  return new NextRequest("https://carelink.example/patient", {
    headers: authorization ? { authorization } : undefined,
  });
}

function basic(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deployment access middleware", () => {
  it("allows local development without credentials", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(middleware(request()).status).toBe(200);
  });

  it("fails closed when production credentials are missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.DEMO_ACCESS_USERNAME;
    delete process.env.DEMO_ACCESS_PASSWORD;
    expect(middleware(request()).status).toBe(503);
  });

  it("challenges invalid credentials and accepts valid credentials", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_ACCESS_USERNAME", "team");
    vi.stubEnv("DEMO_ACCESS_PASSWORD", "private-demo-password");

    const denied = middleware(request(basic("team", "wrong")));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("CareLink Demo");
    expect(middleware(request(basic("team", "private-demo-password"))).status).toBe(200);
  });
});
