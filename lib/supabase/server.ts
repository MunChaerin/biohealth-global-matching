import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error("SUPABASE_URL과 SUPABASE_SECRET_KEY가 필요합니다.");
  client ??= createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}

export function requireProductionStorage(): void {
  if (process.env.NODE_ENV === "production" && !process.env.VITEST && !isSupabaseConfigured()) {
    throw new Error("배포 환경에는 Supabase 저장소 설정이 필요합니다.");
  }
}

export function assertSupabaseResult(error: { message: string } | null): void {
  if (error) throw new Error(`Supabase 저장소 오류: ${error.message}`);
}
