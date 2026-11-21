// Building blocks every page uses: buttons that wait for their work, switches, the page header, dialogs, the toast.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { fail, hideToast, useToast } from "../lib/toast.js";

/** Wrap an event handler: an error it throws (or rejects with) is shown as a toast */
export const act = (fn) => (e) => {
  try {
    const r = fn(e);
    if (r && typeof r.catch === "function") r.catch(fail);
  } catch (err) {
    fail(err);
  }
};

/** A button that stays disabled while its async onClick runs (errors become a toast). busyText: label shown meanwhile. */
export function Btn({ onClick, busyText, disabled, children, className = "btn", ...rest }) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const click = (e) => {
    let r;
    try {
      r = onClick?.(e);
    } catch (err) {
      return fail(err);
    }
    if (!r || typeof r.then !== "function") return; // nothing to wait for
    setBusy(true);
    r.catch(fail).finally(() => alive.current && setBusy(false));
  };
  return (
    <button type="button" className={className} disabled={disabled || busy} onClick={click} {...rest}>
      {busy && busyText ? busyText : children}
    </button>
  );
}

/** On/off switch. With an async onClick it waits like Btn. */
export function Switch({ on, onClick, label = "", disabled }) {
  return <Btn className="sw" role="switch" aria-checked={on ? "true" : "false"} aria-label={label} disabled={disabled} onClick={onClick} />;
}

/**
 * A text box that grows with its text, so long text is never hidden in a small scrolling box.
 * minRows: its height when empty. maxHeight (px): from there on it scrolls. oneLine: Enter doesn't add a line (the text
 * still wraps). `ref` reaches the <textarea>.
 */
export function AutoText({ minRows = 1, maxHeight = 560, oneLine = false, className = "in", ref, onKeyDown, ...rest }) {
  const own = useRef(null);
  const fit = () => {
    const el = own.current;
    if (!el || !el.scrollHeight) return; // not laid out yet (a hidden tab): keep the height given by rows
    el.style.height = "auto";
    const need = el.scrollHeight + 2;
    el.style.height = `${Math.min(maxHeight, need)}px`;
    el.style.overflowY = need > maxHeight ? "auto" : "hidden";
  };
  useLayoutEffect(fit, [rest.value]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <textarea
      className={`${className} auto`}
      rows={minRows}
      ref={(el) => {
        own.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      onKeyDown={(e) => {
        if (oneLine && e.key === "Enter") e.preventDefault();
        onKeyDown?.(e);
      }}
      {...rest}
    />
  );
}

// One listener for every "⋯" menu on the page: a click outside or Esc closes the open one
if (typeof document !== "undefined") {
  const closeMenus = (keep) => {
    for (const d of document.querySelectorAll("details.more[open]")) if (d !== keep) d.removeAttribute("open");
  };
  document.addEventListener("click", (e) => closeMenus(e.target.closest?.("details.more")));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeMenus(null));
}

/** A "⋯" button that opens a small menu with the less-used actions of one row. Choosing an action closes it. */
export function More({ label = "More actions", children }) {
  return (
    <details className="more">
      <summary className="btn ghost sm" aria-label={label} title={label}>
        ⋯
      </summary>
      <div className="more-pop" onClick={(e) => e.currentTarget.parentElement.removeAttribute("open")}>
        {children}
      </div>
    </details>
  );
}

export function Header({ title, desc, right }) {
  return (
    <header className="ph">
      <div>
        <h1>{title}</h1>
        {desc ? <p>{desc}</p> : null}
      </div>
      {right}
    </header>
  );
}

/* --------------------------------- Toast --------------------------------- */

export function Toast() {
  const t = useToast();
  return (
    <div className={`toast${t.on ? " on" : ""}${t.on && t.err ? " err" : ""}`} id="toast" role="status" aria-live="polite">
      {t.msg ? <span>{t.msg}</span> : null}
      {t.action ? (
        <button
          type="button"
          onClick={() => {
            hideToast();
            t.onAction();
          }}
        >
          {t.action}
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------- Dialogs -------------------------------- */

// One dialog at a time: opening another replaces what is shown.
let current = null;
let seq = 0;
const subs = new Set();
const put = (m) => {
  current = m;
  subs.forEach((f) => f());
};

/** Show a dialog. node: a component that renders <Modal>. opts: { wide, focus: selector of the field to focus, onClose(result) } */
export function openModal(node, opts = {}) {
  put({ id: ++seq, node, ...opts });
}
/** Close the dialog. result: the value of the button that closed it ("" for Esc or a close from code) */
export function closeModal(result = "") {
  const m = current;
  if (!m) return;
  put(null);
  m.onClose?.(result);
}

export function ModalHost() {
  const m = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current
  );
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!m) {
      if (d.open) d.close();
      return;
    }
    if (!d.open) d.showModal();
    if (m.focus) d.querySelector(m.focus)?.focus();
  }, [m]);
  // Esc
  const cancel = (e) => {
    e.preventDefault();
    closeModal();
  };
  // Closed by the browser in some other way: keep our state in step (a late event from an earlier dialog is ignored)
  const closed = () => {
    if (!ref.current.open) closeModal();
  };
  return (
    <dialog id="dlg" ref={ref} className={m?.wide ? "wide" : ""} onCancel={cancel} onClose={closed}>
      {m ? <Fragment key={m.id}>{m.node}</Fragment> : null}
    </dialog>
  );
}

/** The frame of a dialog. Buttons with value="…" close it; working buttons are type="button". */
export function Modal({ title, children, footer }) {
  const submit = (e) => {
    e.preventDefault(); // Enter in a field doesn't close the dialog
    const by = e.nativeEvent.submitter;
    if (by && by.value) closeModal(by.value);
  };
  return (
    <form className="dl" method="dialog" noValidate onSubmit={submit}>
      <header>
        <h2>{title}</h2>
        <button className="btn ghost sm" value="close" aria-label="Close">
          ✕
        </button>
      </header>
      <div className="db">{children}</div>
      {footer ? <footer>{footer}</footer> : null}
    </form>
  );
}

/** Ask yes / no. Resolves true only when the confirm button was clicked. */
export function confirmBox(title, text, okLabel = "Delete", danger = true) {
  return new Promise((resolve) => {
    openModal(
      <Modal
        title={title}
        footer={
          <>
            <button className="btn" value="no">
              Cancel
            </button>
            <button className={`btn pri ${danger ? "danger" : ""}`} value="yes">
              {okLabel}
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>{text}</p>
      </Modal>,
      { onClose: (result) => resolve(result === "yes") }
    );
  });
}
