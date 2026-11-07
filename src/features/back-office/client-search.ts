import { formatPhoneDisplay } from "@/lib/format/phone";

/** Client proposé dans le choix du client d'une nouvelle commande (AUDIT-0411, point 5). */
export interface PickableClient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

/** Nom affiché ; l'e-mail seulement quand le compte n'a pas de nom. */
export function clientDisplayName(client: PickableClient): string {
  return `${client.firstName} ${client.lastName}`.trim() || client.email;
}

/** Seconde ligne : le téléphone lisible, sinon l'e-mail s'il n'est pas déjà le nom affiché. */
export function clientDetail(client: PickableClient): string | null {
  if (client.phone?.trim()) return formatPhoneDisplay(client.phone);
  return clientDisplayName(client) === client.email ? null : client.email;
}

function fold(text: string): string {
  return text
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filtre les clients : chaque mot tapé doit se retrouver dans le nom, l'e-mail ou le téléphone,
 * sans tenir compte des accents ni des majuscules ; un numéro se cherche avec ou sans espaces.
 * Ordre : nom qui commence par la saisie, puis ordre alphabétique.
 */
export function searchClients<T extends PickableClient>(clients: readonly T[], query: string): T[] {
  const words = fold(query).split(" ").filter(Boolean);
  const sorted = [...clients].sort((a, b) => clientDisplayName(a).localeCompare(clientDisplayName(b), "fr"));
  if (words.length === 0) return sorted;
  const typed = fold(query);
  const matches = sorted.filter((client) => {
    const name = fold(clientDisplayName(client));
    const email = fold(client.email);
    const phoneDigits = (client.phone ?? "").replace(/\D/g, "");
    return words.every((word) => {
      if (name.includes(word) || email.includes(word)) return true;
      const digits = word.replace(/\D/g, "");
      return digits.length >= 2 && digits === word.replace(/[\s.+-]/g, "") && phoneDigits.includes(digits);
    });
  });
  const startsWith = (client: T) => fold(clientDisplayName(client)).startsWith(typed);
  return [...matches.filter(startsWith), ...matches.filter((client) => !startsWith(client))];
}
