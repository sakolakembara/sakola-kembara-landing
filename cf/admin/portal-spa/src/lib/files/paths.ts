import type { SlotId } from "../../../../shared/application-form/slots";
import { API } from "../paths";

// Where the file routes of the portal are (docs/cloudflare/portal-api.md, 11.2 to 11.4). Pure (no DOM): the Worker's
// contract test (test/portal-files-spa-contract.test.ts) imports it and calls these addresses on the real Worker, so the
// two sides cannot drift apart. Every address is absolute and carries the /portal prefix, like everything sent to the server.

/** `PUT` (a file to a slot) and `DELETE` (`/:fileId`): the student's own application, never an id of anyone's. */
export const FILES_API = `${API}/applications/current/files`;

/** Where a stored file is shown, for a link the student clicks. Nothing loads it by itself (docs/cloudflare/portal-architecture.md, 8.6). */
export const fileHref = (fileId: string) => `${API}/files/${encodeURIComponent(fileId)}`;

/** The `PUT` of a file to `slot`; `replace` is the id of a live file of that slot the new one takes the place of. */
export const uploadPath = (slot: SlotId, replace?: string) => `${FILES_API}/${slot}${replace ? `?replace=${encodeURIComponent(replace)}` : ""}`;

/** The `DELETE` of one of the student's own files. */
export const removePath = (fileId: string) => `${FILES_API}/${encodeURIComponent(fileId)}`;
