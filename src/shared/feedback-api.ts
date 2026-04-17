import type { FeedbackPayload } from './types';

/** 
 * Submit anonymous feedback to the Cloudflare Worker.
 * Using placeholder URL to be replaced with the actual worker URL.
 */
const FEEDBACK_API_URL =
  "https://rsvp-feedback-worker.limitlessone.workers.dev/feedback";

export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  const response = await fetch(FEEDBACK_API_URL, {
    method: 'POST',
    mode: 'cors',
    headers: {
      // Send as application/json to be parsed by the worker, but omit credentials/cookies
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    // Ensure no PII like cookies are sent
    credentials: 'omit',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Feedback submission failed: ${response.status} - ${errorText}`);
  }
}
