import type { Preview } from "@storybook/nextjs-vite";
import { MotionProvider } from "@/components/MotionProvider";
import { fontVariables } from "@/lib/fonts";
import "../app/globals.css";

const preview: Preview = {
  parameters: {
    nextjs: { appDirectory: true },
    controls: { expanded: true },
    options: {
      storySort: {
        order: [
          "Introduction",
          "Foundations",
          ["Logo & brand", "Colors", "Typography", "Iconography", "Layout & spacing", "Shape & elevation", "Motion", "UI copy", "Accessibility"],
          "Atoms",
          "Molecules",
          "Organisms",
          "Sections",
          "Public",
          "Auth",
          "Portal",
          "Admin",
        ],
      },
    },
    backgrounds: {
      options: {
        white: { name: "Putih", value: "#ffffff" },
        gray: { name: "Abu (latar admin)", value: "#f9fafb" },
        // primary-blue, where the navy sections start their gradient.
        navy: { name: "Navy", value: "#122E76" },
      },
    },
    viewport: {
      options: {
        mobile: { name: "HP (375)", styles: { width: "375px", height: "812px" }, type: "mobile" },
        tablet: { name: "Tablet (768)", styles: { width: "768px", height: "1024px" }, type: "tablet" },
        desktop: { name: "Desktop (1280)", styles: { width: "1280px", height: "800px" }, type: "desktop" },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: "white" },
  },
  decorators: [
    // What the root layout gives every page: the two font families and
    // reduced-motion handling.
    (Story) => (
      <MotionProvider>
        <div className={`${fontVariables} antialiased`} style={{ fontFamily: "var(--font-body)" }}>
          <Story />
        </div>
      </MotionProvider>
    ),
  ],
};

export default preview;
