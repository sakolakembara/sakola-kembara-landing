import { komunikasiScreens } from "./komunikasi";
import { kontenScreens } from "./konten";
import { pendaftaranScreens } from "./pendaftaran";
import { sistemScreens } from "./sistem";
import type { Screens } from "./types";

export type { Screen, Screens } from "./types";

/** Every registered screen, by menu path. */
export const SCREENS: Screens = { ...pendaftaranScreens, ...komunikasiScreens, ...kontenScreens, ...sistemScreens };
