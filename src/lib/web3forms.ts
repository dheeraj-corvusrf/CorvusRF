// Same Web3Forms access key/endpoint the contact page uses (src/routes/contact.tsx)
// — reused here for internal staff notifications rather than a second service.
const ENDPOINT = "https://api.web3forms.com/submit";

export async function submitWeb3Form(fields: Record<string, string>): Promise<void> {
  const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY;
  if (!accessKey) return;

  // FormData (not JSON) for the same reason as the contact form: a JSON body's
  // Content-Type header triggers a CORS preflight that Web3Forms' endpoint
  // doesn't answer, which fails the request before it's even sent.
  const formData = new FormData();
  formData.set("access_key", accessKey);
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }

  const res = await fetch(ENDPOINT, { method: "POST", body: formData });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Web3Forms submission failed.");
}
