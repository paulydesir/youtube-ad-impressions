import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { IdentifiedAdImpressionRecord } from "../src/types.ts";
import { manualImpression } from "./manual-impression.ts";
import { sendMessage } from "./dashboard-api.ts";

export function ManualImpressionForm({ onSaved }: { onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  // A timeout may occur after the server commits; reuse this ID on retry.
  const pending = useRef<{ input: string; record: IdentifiedAdImpressionRecord } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const advertiser = String(fields.get("advertiser") ?? "").trim();
    const offer = String(fields.get("offer") ?? "").trim();
    const link = String(fields.get("link") ?? "").trim();
    submitting.current = true;
    setBusy(true); setError(null); setSaved(false);
    try {
      const input = JSON.stringify([advertiser, offer, link]);
      if (pending.current?.input !== input) pending.current = { input, record: manualImpression(advertiser, offer, link) };
      const response = await sendMessage<{ ok: boolean; error?: string }>({ type: "record-impression", record: pending.current.record });
      if (!response.ok) throw new Error(response.error ?? "Could not save the impression.");
      pending.current = null;
      form.reset(); setSaved(true); onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { submitting.current = false; setBusy(false); }
  }
  return <section className="manual-impression" aria-labelledby="manual-impression-heading">
    <h2 id="manual-impression-heading">Add impression</h2>
    <p className="hint">Record an ad or offer you encountered anywhere.</p>
    <form onSubmit={event => void submit(event)}>
      <fieldset disabled={busy}>
        <label htmlFor="impression-advertiser">Advertiser</label>
        <input id="impression-advertiser" name="advertiser" required maxLength={200} placeholder="Bank or business name" />
        <label htmlFor="impression-offer">Offer details</label>
        <textarea id="impression-offer" name="offer" required maxLength={10000} rows={4} placeholder="Sign up for a checking account and get $400. Include any requirements or expiration date." />
        <label htmlFor="impression-link">Source link (optional)</label>
        <input id="impression-link" name="link" type="url" maxLength={2048} placeholder="https://…" />
        <button type="submit">{busy ? "Saving…" : "Save impression"}</button>
      </fieldset>
    </form>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Impression saved.</p>}
  </section>;
}
