import { supabase } from "./supabase";

// supabase-js's default error.message on a non-2xx Edge Function response is a
// generic "non-2xx status code" string — the function's actual { error: "..." }
// reason lives in the response body, which this pulls out so callers can show it.
export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
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
    throw extractedMessage ? new Error(extractedMessage) : error;
  }
  return data as T;
}
