/**
 * searchShortcut tests — the key printed on the search button has to be the key
 * the student's keyboard actually has. The palette opens with either ⌘ or Ctrl
 * (see the global handler in App.tsx), but showing "⌘K" to a Windows or ChromeOS
 * student labels a key that does not exist on their board, and the hint stops
 * being tried. The same reason the help panel draws its non-keyboard pointers
 * with icons instead of key caps: a chip shaped like "→" promises a shortcut.
 */
import { describe, expect, it } from 'vitest';
import { searchShortcutLabel } from '../../components/MeridianHeader';

const UAS = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
};

describe('searchShortcutLabel', () => {
  it('names the Ctrl key on every non-Apple desktop', () => {
    for (const ua of [UAS.windows, UAS.chromeos, UAS.linux, UAS.android, '']) {
      expect(searchShortcutLabel(ua)).toBe('Ctrl K');
    }
  });

  it('names the ⌘ key on Apple keyboards', () => {
    for (const ua of [UAS.mac, UAS.iphone, UAS.ipad]) {
      expect(searchShortcutLabel(ua)).toBe('⌘K');
    }
  });

  it('keeps the label short enough for the chip it sits in', () => {
    expect(searchShortcutLabel(UAS.windows).length).toBeLessThanOrEqual(6);
  });
});
