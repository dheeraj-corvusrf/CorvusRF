import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Us — CorvusRF.ai" },
      {
        name: "description",
        content: "Talk to CorvusRF.ai about your Texas property tax questions.",
      },
      { property: "og:title", content: "Contact CorvusRF.ai" },
      { property: "og:description", content: "Reach the CorvusRF property tax team." },
    ],
  }),
  component: Contact,
});

function Contact() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY;
    if (!accessKey) {
      setError("Contact form isn't set up in this deployment yet. Please check back soon.");
      return;
    }

    setSending(true);
    try {
      // Submitted as FormData (not JSON) so the browser treats this as a CORS-simple
      // request — a JSON body with a Content-Type header triggers a preflight that
      // Web3Forms' endpoint doesn't answer, which fails the request before it sends.
      const formData = new FormData();
      formData.set("access_key", accessKey);
      formData.set("subject", "New CorvusRF.ai contact form submission");
      formData.set("name", name);
      formData.set("email", email);
      formData.set("message", message);

      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Could not send your message.");
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send your message. Please try again.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="container-page py-16 max-w-2xl">
      <span className="badge-soft">Contact</span>
      <h1 className="mt-3 text-4xl md:text-5xl font-semibold">Talk to a human.</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Managed protests, portfolios, and BPP for multiple entities — we'll help you get started.
      </p>

      {sent ? (
        <div className="mt-8 card-elev p-6">
          <h3 className="font-semibold text-lg">Thanks — we'll be in touch.</h3>
          <p className="text-muted-foreground mt-1">
            A CorvusRF specialist will reach out within one business day.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">How can we help?</span>
            <textarea
              rows={5}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            disabled={sending}
            className="btn-primary btn-primary-hover w-fit disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send message"}
          </button>
        </form>
      )}
    </div>
  );
}
