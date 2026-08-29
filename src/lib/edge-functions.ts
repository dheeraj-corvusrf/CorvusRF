import { supabase } from "./supabase";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// supabase-js's default error.message on a non-2xx Edge Function response is a
// generic "non-2xx status code" string — the function's actual { error: "..." }
// reason lives in the response body, which this pulls out so callers can show it.
//
// Every AI-backed function forwards Gemini's 429 as-is (see e.g. the `res.status
// === 429` check in ai-report-modules/index.ts) rather than absorbing it, since
// it's a transient "try again shortly" condition, not a real failure — so this
// retries those with exponential backoff before surfacing an error. Any other
// status fails immediately; retrying those wouldn't help.
export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.functions.invoke<T>(name, { body });
    if (!error) return data as T;

    const context = (error as { context?: Response }).context;
    let extractedMessage: string | undefined;
    if (context) {
      try {
        const payload = (await context.clone().json()) as { error?: string };
        extractedMessage = payload?.error;
      } catch {
        // response body wasn't JSON — fall through to the generic error below
      }
    }
    const thrown = extractedMessage ? new Error(extractedMessage) : error;

    if (context?.status !== 429 || attempt >= MAX_RETRIES) throw thrown;
    await sleep(BASE_DELAY_MS * 2 ** attempt + Math.random() * 300);
  }
}
