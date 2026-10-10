/** Utilitaires de composition de classes CSS. */

type ClassValue = string | number | null | undefined | false | ClassValue[];

function flatten(values: ClassValue[], out: string[]): void {
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) flatten(value, out);
    else out.push(String(value));
  }
}

/** Concatène des classes conditionnelles (équivalent minimal de `clsx`). */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  flatten(inputs, out);
  return out.join(" ");
}
