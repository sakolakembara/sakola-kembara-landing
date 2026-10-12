// jsdom has no `HTMLDialogElement.showModal()` or `close()`. This gives it the part of the browser's behaviour that
// the code under test relies on: `showModal()` makes the dialog `open`, `close()` closes it and fires `close`.
// What jsdom cannot do, and the tests therefore do not prove: the top layer, making the page behind inert, and the
// focus trap. Those are the browser's own (DESIGN.md, Modals); what these tests prove is what OUR code does around
// them: the roles and names, where the focus starts and returns, and what Escape and the backdrop answer.

export function installDialogShim(): void {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: (this: HTMLDialogElement) => void;
    show?: (this: HTMLDialogElement) => void;
    close?: (this: HTMLDialogElement) => void;
  };
  proto.showModal = function () {
    if (this.hasAttribute("open")) throw new DOMException("The dialog is already open.", "InvalidStateError");
    this.setAttribute("open", "");
  };
  proto.show = proto.showModal;
  proto.close = function () {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

/** What a browser does on Escape in a modal dialog: a cancelable `cancel` event, then it closes the dialog unless the event was prevented. */
export function pressEscapeIn(dialog: HTMLDialogElement): boolean {
  const event = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(event);
  if (!event.defaultPrevented) dialog.close();
  return event.defaultPrevented;
}
