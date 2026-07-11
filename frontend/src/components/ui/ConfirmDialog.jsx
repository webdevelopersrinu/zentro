import { Modal } from "./Modal.jsx";
import { Button } from "./Button.jsx";

/**
 * The confirmation every destructive action is paired with. The confirm button
 * carries the verb ("Leave room"), never "OK": a user skimming the dialog reads
 * the button, not the prose.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
    </Modal>
  );
}
