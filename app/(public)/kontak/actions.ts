"use server";

import { rateLimit } from "@/lib/rate-limit";
import {
  CONTACT_MESSAGES,
  CONTACT_RATE_LIMIT,
  parseContactInput,
  saveContactMessage,
  type ContactFieldErrors,
} from "@/lib/contact";

export type ContactFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: ContactFieldErrors;
};

export async function submitContactMessage(
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const limit = await rateLimit(CONTACT_RATE_LIMIT);
  if (!limit.allowed) {
    return { status: "error", message: CONTACT_MESSAGES.rateLimited };
  }

  const parsed = parseContactInput({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    subject: formData.get("subject"),
    message: formData.get("message"),
    website: formData.get("website") ?? "",
  });

  // Silently drop honeypot hits — don't tell the bot why it failed.
  if (parsed.kind === "honeypot") return { status: "success", message: "OK" };
  if (parsed.kind === "invalid") {
    return {
      status: "error",
      message: CONTACT_MESSAGES.invalid,
      fieldErrors: parsed.fieldErrors,
    };
  }

  // Soft anti-duplicate: reject same email submitted within the last 5 min.
  if ((await saveContactMessage(parsed.data)) === "duplicate") {
    return { status: "error", message: CONTACT_MESSAGES.duplicate };
  }

  return { status: "success", message: CONTACT_MESSAGES.success };
}
