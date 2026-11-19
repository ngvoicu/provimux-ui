import { PROVIMUX_LINKS } from '../brand';

interface ProvimuxTaglineProps {
  className?: string;
  /** Link "providers.dev" to the site. */
  link?: boolean;
}

/**
 * "by providers.dev", set as the providers.dev header sets its name: "by" and ".dev" muted, "providers" a step
 * stronger. English in every language.
 */
export function ProvimuxTagline({ className, link = false }: ProvimuxTaglineProps) {
  const name = (
    <>
      <span className="pmx-tagline-name">providers</span>
      <span className="pmx-tagline-tld">.dev</span>
    </>
  );
  return (
    <span className={className ? `pmx-tagline ${className}` : 'pmx-tagline'}>
      <span className="pmx-tagline-by">by </span>
      {link ? (
        <a
          className="pmx-tagline-link"
          href={PROVIMUX_LINKS.providersDev}
          target="_blank"
          rel="noopener noreferrer"
        >
          {name}
        </a>
      ) : (
        name
      )}
    </span>
  );
}
