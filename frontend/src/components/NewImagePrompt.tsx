interface Props {
  imageName: string;
  cameraName: string;
  onAssign: () => void;
  onDismiss: () => void;
}

export default function NewImagePrompt({ imageName, cameraName, onAssign, onDismiss }: Props) {
  return (
    <div className="new-image-banner">
      <div className="image-name">
        New screenshot detected
        <span>{imageName}</span>
      </div>
      <button className="btn-assign" onClick={onAssign}>
        Add to {cameraName}
      </button>
      <button className="btn-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
