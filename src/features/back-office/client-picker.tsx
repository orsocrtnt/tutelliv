"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientDetail, clientDisplayName, searchClients, type PickableClient } from "./client-search";

interface ClientPickerProps {
  id: string;
  clients: readonly PickableClient[];
  value: string;
  onChange: (clientId: string) => void;
  invalid?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * Choix du client avec recherche par nom, téléphone ou e-mail (AUDIT-0411, point 5).
 * Remplace la liste native : utilisable avec beaucoup de clients, au clavier comme au doigt.
 */
export function ClientPicker({ id, clients, value, onChange, invalid, inputRef }: ClientPickerProps) {
  const listId = `${id}-options`;
  const selected = clients.find((client) => client.id === value);
  const [query, setQuery] = React.useState(selected ? clientDisplayName(selected) : "");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  // Saisie identique au client choisi : on montre toute la liste, pas ce seul client.
  const filter = selected && query === clientDisplayName(selected) ? "" : query;
  const matches = React.useMemo(() => searchClients(clients, filter), [clients, filter]);
  const optionId = (clientId: string) => `${id}-option-${clientId}`;

  React.useEffect(() => {
    setActive(0);
  }, [filter]);
  React.useEffect(() => {
    if (!open) return;
    const item = matches[active];
    if (item) document.getElementById(`${id}-option-${item.id}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id, matches, open]);

  const choose = (client: PickableClient) => {
    onChange(client.id);
    setQuery(clientDisplayName(client));
    setOpen(false);
  };

  const close = () => {
    setOpen(false);
    setQuery(selected ? clientDisplayName(selected) : "");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (matches.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      const client = matches[active];
      if (client) choose(client);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };

  const showList = open && clients.length > 0;

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && matches[active] ? optionId(matches[active].id) : undefined}
        aria-invalid={invalid}
        autoComplete="off"
        spellCheck={false}
        placeholder="Rechercher un client : nom, téléphone ou e-mail"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        onFocus={(event) => {
          setOpen(true);
          event.currentTarget.select();
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-10 w-full rounded-lg border border-input bg-background py-2 pl-9 pr-9 text-sm placeholder:text-muted-foreground max-md:h-11 max-md:text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          invalid && "border-destructive"
        )}
      />
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-transform",
          showList && "rotate-180"
        )}
        aria-hidden="true"
      />
      <div
        id={listId}
        role="listbox"
        aria-label="Clients"
        hidden={!showList}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        {matches.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">Aucun client ne correspond à « {query.trim()} ».</p>
        ) : (
          matches.map((client, index) => {
            const detail = clientDetail(client);
            const isActive = index === active;
            return (
              <div
                key={client.id}
                id={optionId(client.id)}
                role="option"
                aria-selected={client.id === value}
                // Garder le focus dans le champ : le clic choisit sans fermer la liste avant.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(client)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm",
                  isActive && "bg-accent text-accent-foreground"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{clientDisplayName(client)}</span>
                  {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
                </span>
                {client.id === value && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
