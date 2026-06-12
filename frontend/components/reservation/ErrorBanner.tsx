type ErrorBannerProps = {
  error: string | null;
};

export function ErrorBanner({ error }: ErrorBannerProps) {
  if (!error) {
    return null;
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
      {error}
    </div>
  );
}
