// Custom confirm dialog, replacing the native confirm() popup so destructive
// actions look and feel like part of the app instead of a browser prompt.
// Built on <dialog> for free focus-trapping, Escape-to-close and a native
// ::backdrop to dim the page.
//
// Safety default: focus starts on the cancel/safe button, not the destructive
// confirm button. Unlike confirm(), where there's no click-through risk
// (the browser prompt blocks all input until you consciously choose), a
// custom in-page dialog can be dismissed by a stray Enter/Space press that
// lands on whatever's focused — so the default focus target here must never
// be the button that deletes something.
export function confirmDialog({ title, body, confirmLabel = "Bevestigen", cancelLabel = "Annuleren", danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "ui-dialog";

    const heading = document.createElement("h3");
    heading.className = "ui-dialog-title";
    heading.textContent = title;
    dialog.appendChild(heading);

    const bodyEl = document.createElement("p");
    bodyEl.className = "ui-dialog-body";
    bodyEl.textContent = body;
    dialog.appendChild(bodyEl);

    const actions = document.createElement("div");
    actions.className = "ui-dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = danger ? "btn btn-primary ui-dialog-confirm-danger" : "btn btn-primary";
    confirmBtn.textContent = confirmLabel;

    // Cancel first in the DOM/tab order and the one that receives autofocus —
    // see the safety note above.
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);

    document.body.appendChild(dialog);

    let settled = false;
    function settle(result) {
      if (settled) return;
      settled = true;
      resolve(result);
      dialog.close();
    }

    cancelBtn.addEventListener("click", () => settle(false));
    confirmBtn.addEventListener("click", () => settle(true));

    // Backdrop click = cancel. A click that starts and ends on the dialog
    // element itself but outside its padded content also lands here, since
    // <dialog> has no separate backdrop hit-target of its own — this matches
    // the well-known "click on ::backdrop" pattern of checking the event
    // target against the dialog element.
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) settle(false);
    });

    // Escape closes the <dialog> natively; catch it as a cancel and stop the
    // native close from firing a second time via our own dialog.close() above.
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      settle(false);
    });

    dialog.addEventListener("close", () => {
      settle(false); // covers any other way the dialog could close
      dialog.remove();
    });

    dialog.showModal();
    // autofocus would move focus before the dialog is in the document in some
    // browsers; doing it explicitly after showModal() is reliable everywhere.
    cancelBtn.focus();
  });
}
