/**
 * Characters that take no space on the page and stand inside words: the soft hyphen (generators and
 * site builders write "Daten&shy;schutz&shy;erklärung"), zero-width space and joiners, the word joiner
 * and the byte order mark. Session fix-a3, review finding 16: a label or a link text with one of them
 * inside is still the same word.
 */
const INVISIBLE = /[­​-‍⁠﻿]/g;

/** Text without the invisible characters; the same string for a text without them. */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '');
}
