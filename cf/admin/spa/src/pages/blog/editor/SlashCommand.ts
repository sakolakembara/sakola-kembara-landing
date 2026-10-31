import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { SlashMenu, type SlashMenuHandle, type SlashMenuProps } from "./SlashMenu";
import { filterSlashItems, type SlashItem } from "./slashItems";

// "/" opens the block menu (Notion's way). Built on the suggestion plugin of TipTap: it finds the "/word" the person is
// typing, and this puts the menu (SlashMenu) next to it. The menu is a fixed box in the page, not inside the text, so
// the editor's own box cannot clip it.

export interface SlashCommandOptions {
  /** Opens the file picker, for the "Gambar" item. */
  onPickImage: () => void;
}

const GAP = 8;

/** Under the "/", or above it when there is no room below, and inside the window sideways. */
function place(element: HTMLElement, anchor: DOMRect) {
  element.style.position = "fixed";
  element.style.zIndex = "40";
  const { offsetWidth: width, offsetHeight: height } = element;
  const below = anchor.bottom + GAP;
  const top = below + height > window.innerHeight && anchor.top - GAP - height > 0 ? anchor.top - GAP - height : below;
  const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - width - GAP));
  element.style.top = `${top}px`;
  element.style.left = `${left}px`;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return { onPickImage: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        // Only after a space or at the start of a line, so an address ("https://") is not a command.
        allowedPrefixes: [" "],
        // Not inside code, where a "/" is a "/".
        allow: ({ editor }) => !editor.isActive("codeBlock") && !editor.isActive("code"),
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.run({ editor, range, pickImage: options.onPickImage }),
        render: () => {
          let renderer: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;
          const show = (clientRect: (() => DOMRect | null) | null | undefined) => {
            const anchor = clientRect?.();
            if (renderer && anchor) place(renderer.element as HTMLElement, anchor);
          };
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashMenu, { editor: props.editor, props: { editor: props.editor, items: props.items, command: props.command } });
              document.body.appendChild(renderer.element);
              show(props.clientRect);
            },
            onUpdate: (props) => {
              renderer?.updateProps({ editor: props.editor, items: props.items, command: props.command });
              show(props.clientRect);
            },
            onKeyDown: ({ event }) => renderer?.ref?.onKeyDown(event) ?? false,
            onExit: () => {
              renderer?.destroy();
              renderer?.element.remove();
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});
