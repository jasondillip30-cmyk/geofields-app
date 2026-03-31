import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-app-gradient px-4">
      <section className="w-full max-w-lg rounded-2xl border border-white/80 bg-white/90 p-6 text-center shadow-card">
        <h1 className="font-display text-2xl text-ink-900">Access Restricted</h1>
        <p className="mt-2 text-sm text-ink-600">
          Your role does not have permission for this page. Contact an administrator if this looks incorrect.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Return to Home
        </Link>
      </section>
    </main>
  );
}
