"use client";

import { useEffect } from "react";
import { markMessageAsRead } from "../actions";

/**
 * Stamps the message as read once the page is open. It runs from the client
 * because the action revalidates the inbox cache, which Next does not allow
 * during a render.
 */
export function MarkAsRead({ id }: { id: string }) {
  useEffect(() => {
    void markMessageAsRead(id);
  }, [id]);
  return null;
}
