/**
 * One way to write the size of a file, in units a student actually reads.
 *
 * The syllabus sheet and the LMS offline cache each carried their own
 * formatter. They agreed on every value one of them was ever asked to print,
 * which is exactly the kind of duplicate that survives until someone edits
 * one of them — then the same PDF reads "1.4 MB" in one sheet and "1 MB" in
 * another, and the student has to decide which number the app meant.
 */

/** Bytes in a kilobyte — files are counted in binary multiples on disk. */
const KB = 1024;

/**
 * A file size for display.
 *
 * `null`, `undefined`, a negative number or a non-finite one means the size
 * was never measured, and prints as nothing: a missing byte count shown as
 * "0 B" tells the student VTOP served an empty file, which is not what
 * happened. A real zero is different and does print — an empty offline cache
 * is genuinely "0 B of 200 MB used".
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < KB) return `${Math.round(bytes)} B`;
  const kb = bytes / KB;
  if (kb < KB) return `${Math.round(kb)} KB`;
  return `${(kb / KB).toFixed(1)} MB`;
}
