'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="card mt-10">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="hint">
          Please try again. If you run this site and this keeps happening, check that DATABASE_URL and APP_SECRET are set and that the
          database migrations have run (see DEPLOYMENT.md).
        </p>
        <button className="btn btn-primary mt-4" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
