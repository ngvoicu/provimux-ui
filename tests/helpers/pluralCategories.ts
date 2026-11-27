/**
 * The plural forms a language needs, whichever ICU data the runtime ships: Bun's (it runs the tests), Node's (read by
 * running tests/helpers/pluralForms.mjs under Node) and the forms newer CLDR data adds (NEWER_CLDR_FORMS). The ICU
 * data differs between builds of the same runtime: Node 24.22.3 as Homebrew builds it (system ICU 79.1, CLDR 49) gives
 * Vietnamese "one", the official build CI installs does not, nor do Bun's and Chrome 159's. A form a language lacks
 * falls back to English, so a language holds every form any of them may ask for, and the required set is the same on
 * every machine.
 */
const NEWER_CLDR_FORMS: Record<string, string[]> = {
  // CLDR 49 (ICU 79) gives Vietnamese the cardinal form "one".
  vi: ['one'],
};

let nodeForms: Record<string, string[]> | null = null;

function readNodeForms(): Record<string, string[]> {
  if (nodeForms) return nodeForms;
  const run = Bun.spawnSync(['node', 'tests/helpers/pluralForms.mjs']);
  if (run.exitCode !== 0) throw new Error(`node could not run: ${run.stderr.toString()}`);
  nodeForms = (JSON.parse(run.stdout.toString()) as { forms: Record<string, string[]> }).forms;
  return nodeForms;
}

export function pluralCategories(language: string): string[] {
  return [
    ...new Set([
      ...new Intl.PluralRules(language).resolvedOptions().pluralCategories,
      ...(readNodeForms()[language] ?? []),
      ...(NEWER_CLDR_FORMS[language] ?? []),
    ]),
  ];
}
