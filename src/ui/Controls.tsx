import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Icon } from "./Icon";
export function ToolButton({
  icon,
  label,
  onClick,
  active,
  disabled = false,
  children,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          className={"icon-button " + (active ? "active" : "")}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon name={icon} />
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="top" className="tooltip" sideOffset={8}>
          {label}
          <Tooltip.Arrow />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min = -10000,
  max = 10000,
  disabled = false,
  unit,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  unit?: string;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  const cancelBlur = useRef(false);
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  function commit() {
    if (cancelBlur.current) { cancelBlur.current = false; return; }
    const next = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    const n = Math.min(max, Math.max(min, next));
    setDraft(String(n));
    if (n !== value) onChange(n);
  }
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        step="0.1"
        value={draft}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") ev.currentTarget.blur();
          if (ev.key === "Escape") {
            cancelBlur.current = true;
            setDraft(String(value));
            ev.currentTarget.blur();
          }
        }}
      />
      {unit && <small>{unit}</small>}
    </label>
  );
}
export function TextField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="text-field"
      aria-label={label}
      value={draft}
      maxLength={100}
      disabled={disabled}
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={() => {
        if (draft.trim()) onChange(draft.trim());
        else setDraft(value);
      }}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") ev.currentTarget.blur();
      }}
    />
  );
}
