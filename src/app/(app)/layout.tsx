import Link from "next/link";
import { MainNav } from "@/components/main-nav";
import { requireUser } from "@/lib/auth/guard";
import { signOutAction } from "../login/actions";

/**
 * Layout for every private page.
 *
 * `requireUser()` re-checks the session on the server: the middleware redirect
 * alone is a convenience, not a security boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const signOut = (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Se déconnecter
      </button>
    </form>
  );

  return (
    <div className="flex min-h-full flex-col">
      <header className="relative border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            Tableau de bord
          </Link>

          <MainNav>
            {/* Small screens: the account controls live in the burger menu. */}
            <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</span>
              {signOut}
            </div>
          </MainNav>

          <div className="hidden items-center gap-3 lg:flex">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{user.email}</span>
            {signOut}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
