import { Lora, Plus_Jakarta_Sans } from "next/font/google";

const lora = Lora({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

/**
 * Classes that define `--font-display` (Lora) and `--font-body` (Plus Jakarta
 * Sans). Set on `<body>` by the root layout and on the Storybook canvas.
 */
export const fontVariables = `${lora.variable} ${plusJakartaSans.variable}`;
