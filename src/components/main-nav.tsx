"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavLink = { href: string; label: string };

/**
 * Navigation only: no sensitive data and no authorisation decision here. The links
 * arrive already filtered by the server layout from the workspace's active modules.
 */
export function MainNav({ links }: { links: readonly NavLink[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation principale" className="flex flex-wrap gap-1">
      {links.map((link) => {
        const isActive =
          pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
