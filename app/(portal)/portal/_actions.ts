"use server";

import { signOut } from "@/auth";

export async function portalSignOut() {
  await signOut({ redirectTo: "/" });
}
