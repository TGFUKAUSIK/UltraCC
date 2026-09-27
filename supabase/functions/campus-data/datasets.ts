/**
 * datasets.ts — pure validation + sanitization for campus-data datasets.
 *
 * Ingested upstream payloads are NEVER trusted: every dataset must pass its
 * shape validator before it may be cached, and text fields are sanitized
 * (tags stripped, cover URLs only echoed when well-formed http(s)).
 */

export interface Club {
  club_id: string;
  club_name: string;
  mission?: string;
  description?: string;
  hiring_process?: string;
  website?: string;
  recruitment_link?: string;
  instagram?: string;
  whatsapp?: string;
  poc?: string;
  poc_phone?: string;
  email?: string;
  updated_at?: string;
  logo_url?: string | null;
}

export interface Book {
  biblionumber: string;
  title: string;
  author?: string;
  publisher?: string;
  isbn?: string;
  coverUrl?: string;
}

export interface Holding {
  itemId?: string;
  barcode?: string;
  shelvingLocation?: string;
  callNumber?: string;
  status?: string;
  currentLibrary?: string;
  dateDue?: string | null;
}

export interface BookDetail extends Book {
  edition?: string;
  description?: string;
  subjects?: string[];
  ddc?: string;
  summary?: string;
  holdings?: Holding[];
}

export function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]+>/g, ' ')
    // A stripped tag before punctuation must not leave "summary ." artifacts.
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isValidClubs(clubs: unknown): clubs is Club[] {
  return (
    Array.isArray(clubs) &&
    clubs.length > 0 &&
    clubs.every(
      (c) =>
        c != null && typeof c === 'object' &&
        typeof (c as Club).club_id === 'string' && (c as Club).club_id.length > 0 &&
        typeof (c as Club).club_name === 'string' && (c as Club).club_name.length > 0,
    )
  );
}

export function isValidBooks(books: unknown): books is Book[] {
  return (
    Array.isArray(books) &&
    books.every(
      (b) =>
        b != null && typeof b === 'object' &&
        typeof (b as Book).biblionumber === 'string' && (b as Book).biblionumber.length > 0 &&
        typeof (b as Book).title === 'string' && (b as Book).title.length > 0,
    )
  );
}

/** Only well-formed http(s) URLs may be echoed back to the client. */
export function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeBook<T extends Book>(book: T): T {
  return {
    ...book,
    title: sanitizeText(book.title),
    author: sanitizeText(book.author) || undefined,
    publisher: sanitizeText(book.publisher) || undefined,
    isbn: sanitizeText(book.isbn) || undefined,
    // coverUrl is only echoed when it is a well-formed http(s) URL
    coverUrl: isValidHttpUrl(book.coverUrl) ? book.coverUrl : undefined,
  };
}

/**
 * Sanitize a single club record: text fields are tag-stripped, URLs are
 * only echoed when well-formed http(s) (a `javascript:` URL must never
 * reach an href). Nothing is dropped silently otherwise — a club with a
 * malformed link still survives with that link removed.
 */
export function sanitizeClub(club: Club): Club {
  const cleaned: Club = {
    ...club,
    club_id: sanitizeText(club.club_id),
    club_name: sanitizeText(club.club_name),
    mission: sanitizeText(club.mission) || undefined,
    description: sanitizeText(club.description) || undefined,
    hiring_process: sanitizeText(club.hiring_process) || undefined,
    website: isValidHttpUrl(club.website) ? club.website : undefined,
    recruitment_link: isValidHttpUrl(club.recruitment_link) ? club.recruitment_link : undefined,
    instagram: isValidHttpUrl(club.instagram) ? club.instagram : undefined,
    whatsapp: isValidHttpUrl(club.whatsapp) ? club.whatsapp : undefined,
    poc: sanitizeText(club.poc) || undefined,
    poc_phone: sanitizeText(club.poc_phone) || undefined,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(club.email ?? '')) ? club.email : undefined,
    // Invalid/missing logo becomes undefined (absent), not null, so the
    // sanitized record keeps the same shape as an unsanitized one.
    logo_url: isValidHttpUrl(club.logo_url) ? club.logo_url : undefined,
  };
  return cleaned;
}

export function sanitizeClubs(clubs: Club[]): Club[] {
  return clubs.map(sanitizeClub).filter((c) => c.club_id && c.club_name);
}

export function sanitizeBooks(books: Book[]): Book[] {
  return books.map(sanitizeBook).filter((b) => b.title && b.biblionumber);
}

export function sanitizeBookDetail(book: BookDetail): BookDetail {
  const base = sanitizeBook(book) as BookDetail;
  return {
    ...base,
    edition: sanitizeText(base.edition) || undefined,
    description: sanitizeText(base.description) || undefined,
    ddc: sanitizeText(base.ddc) || undefined,
    summary: sanitizeText(base.summary) || undefined,
    subjects: Array.isArray(base.subjects)
      ? base.subjects.map((s) => sanitizeText(s)).filter(Boolean)
      : undefined,
    holdings: Array.isArray(base.holdings) ? base.holdings : undefined,
  };
}

/** Search cache keys are normalized (trim, lowercase, collapse whitespace). */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
}

/** biblionumber is a KOHA record id — restrict to a conservative charset. */
export function isValidBiblionumber(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id.trim());
}
