// Prints this runtime's plural categories for the console's seven languages, as JSON. Run by
// tests/provimux/aliases-page.test.ts under Node (Bun runs the test itself): the two ship different ICU data, and
// Node's gives Vietnamese a "one" form that Bun's does not, so a language must hold the forms of both.
const languages = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr'];
const forms = Object.fromEntries(
  languages.map((language) => [
    language,
    new Intl.PluralRules(language).resolvedOptions().pluralCategories,
  ])
);
process.stdout.write(JSON.stringify({ runtime: process.version, forms }));
