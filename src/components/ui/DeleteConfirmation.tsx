import { Modal } from './Modal';

interface DeleteConfirmationProps {
  kind: 'event' | 'task';
  itemTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmation({
  kind,
  itemTitle,
  onCancel,
  onConfirm,
}: DeleteConfirmationProps) {
  return (
    <Modal
      open
      title={`Delete ${kind}?`}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-danger px-3 py-1.5 text-[12px] font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Delete
          </button>
        </>
      }
    >
      <p className="text-[13px] text-text-2">
        Delete &ldquo;{itemTitle}&rdquo;? This cannot be undone.
      </p>
    </Modal>
  );
}
