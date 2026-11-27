// Prints this runtime's plural categories for the console's seven languages, as JSON. Run by
// tests/helpers/pluralCategories.ts under Node (Bun runs the test itself): runtimes and their builds ship different
// ICU data (Node with CLDR 49 gives Vietnamese a "one" form that Bun's does not), so a language must hold the forms
// of each.
const languages = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr'];
const forms = Object.fromEntries(
  languages.map((language) => [
    language,
    new Intl.PluralRules(language).resolvedOptions().pluralCategories,
  ])
);
process.stdout.write(JSON.stringify({ runtime: process.version, forms }));
