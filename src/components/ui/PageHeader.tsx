import type { JSX, ReactNode } from 'react';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
  className = '',
}: PageHeaderProps): JSX.Element {
  return (
    <div className={`mb-6 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-1 text-sm text-[var(--color-muted)]">
            {breadcrumbs.map((item, index) => (
              <li key={index} className="flex items-center gap-1">
                {index > 0 && (
                  <svg
                    className="h-3.5 w-3.5 text-[var(--color-muted-light)]"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {item.href ? (
                  <a
                    href={item.href}
                    className="hover:text-[var(--color-foreground)] transition-colors"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span className="text-[var(--color-foreground)] font-medium">{item.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-[var(--color-muted)]">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}
