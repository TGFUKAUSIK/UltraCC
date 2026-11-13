import { describe, expect, it } from 'vitest';
import { formatFileSize } from '../fileSize';

describe('one file size, written one way', () => {
  it('reads as a size, not a byte count', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(1_500_000)).toBe('1.4 MB');
    expect(formatFileSize(200 * 1024 * 1024)).toBe('200.0 MB');
  });

  it('says zero when a cache really is empty', () => {
    // The offline-cache line reads "0 B of 200 MB used" on a fresh device; a
    // blank there looked like the app had lost the student's files.
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('says nothing when nobody measured the size', () => {
    // VTOP and the LMS both leave the byte count out sometimes. Printing "0 B"
    // for a file that was never sized would claim VTOP served an empty PDF.
    for (const unknown of [null, undefined, Number.NaN, -1]) {
      expect(formatFileSize(unknown as number | null | undefined)).toBe('');
    }
  });

  it('switches unit at the boundary a student would notice', () => {
    expect(formatFileSize(1023)).toBe('1023 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });
});
