/**
 * The plural forms a language needs under both runtimes the console's strings meet: Bun's (it runs the tests) and
 * Node's (CI's Node.js 24, and browsers with the same CLDR data), read by running tests/helpers/pluralForms.mjs under
 * Node. Node's ICU gives Vietnamese "one", Bun's does not; a form a language lacks falls back to English.
 */
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
    ]),
  ];
}
