// jsdom has no layout, and ProseMirror (under TipTap) asks the browser where a character is and what is under a point
// whenever the selection moves or a node is dropped: `Range.getClientRects`, `Range.getBoundingClientRect` and
// `document.elementFromPoint`. This answers them with nothing (an empty list, a zero box), which is what ProseMirror
// expects of a node that is not drawn, so the editor can be driven in a test. Positions are never tested through it.

export function installProseMirrorShim() {
  const box = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
  const none = () => Object.assign([] as unknown as DOMRectList, { item: () => null });
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = box;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = none;
  if (!Document.prototype.elementFromPoint) Document.prototype.elementFromPoint = () => null;
}
