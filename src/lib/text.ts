/** A Postgres text column cannot hold a NUL (\u0000) and answers with an error, so a paste from a PDF or a binary file would lose the tip. Remove it where text enters. */
export const withoutNul = (s: string): string => s.replaceAll('\0', '');
