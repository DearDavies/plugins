import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export type AppMenuOption = { value: string; label: string };

type AppMenuProps = {
  label: string;
  value: string;
  options: AppMenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

/** A Magpie-style listbox trigger, with native keyboard semantics. */
export function AppMenu({ label, value, options, onChange, disabled = false }: AppMenuProps) {
  const id = useId();
  const listId = `app-menu-${id.replace(/:/g, '')}`;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [active, setActive] = useState(selected);

  useEffect(() => setActive(selected), [selected]);
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent | PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const choose = (next: number) => {
    const option = options[next];
    if (!option) return;
    setActive(next);
    onChange(option.value);
    setOpen(false);
    button.current?.focus();
  };

  const move = (delta: number) => {
    if (!options.length) return;
    setActive((current) => (current + delta + options.length) % options.length);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      if (!open) setOpen(true);
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, options.length - 1));
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(active);
    }
  };

  return (
    <div className="app-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="app-menu-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setActive(selected);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'ArrowDown' ||
            event.key === 'ArrowUp' ||
            event.key === 'Enter' ||
            event.key === ' '
          ) {
            event.preventDefault();
            setActive(selected);
            setOpen(true);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      >
        <span>{options.find((option) => option.value === value)?.label ?? value}</span>
        <span className="app-menu-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      <div
        id={listId}
        ref={list}
        className="app-menu-list"
        role="listbox"
        aria-label={label}
        aria-activedescendant={`${listId}-option-${active}`}
        tabIndex={open ? 0 : -1}
        hidden={!open}
        onKeyDown={onListKeyDown}
        onBlur={(event) => {
          if (!root.current?.contains(event.relatedTarget as Node)) setOpen(false);
        }}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            id={`${listId}-option-${index}`}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={[option.value === value ? 'selected' : '', index === active ? 'active' : '']
              .filter(Boolean)
              .join(' ')}
            tabIndex={-1}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(index)}
          >
            <span>{option.label}</span>
            {option.value === value && <span aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
