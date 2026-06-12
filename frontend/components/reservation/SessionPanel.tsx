import type { FormEvent } from "react";

import type { SessionResponse } from "@/lib/reservation/types";

type SessionPanelProps = {
  authenticated: boolean;
  loginLoading: boolean;
  logoutLoading: boolean;
  password: string;
  session: SessionResponse | null;
  sessionLoading: boolean;
  username: string;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onLogout: () => void;
  onPasswordChange: (password: string) => void;
  onUsernameChange: (username: string) => void;
};

export function SessionPanel({
  authenticated,
  loginLoading,
  logoutLoading,
  password,
  session,
  sessionLoading,
  username,
  onLogin,
  onLogout,
  onPasswordChange,
  onUsernameChange,
}: SessionPanelProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Session</h2>
        <span className="text-sm font-medium text-slate-600">
          {sessionLoading ? "Checking" : authenticated ? "Signed in" : "Signed out"}
        </span>
      </div>

      {authenticated ? (
        <div className="space-y-4">
          <p className="break-words text-sm text-slate-700">
            {session?.user?.email || session?.user?.username || username}
          </p>
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={logoutLoading}
            onClick={() => void onLogout()}
            type="button"
          >
            {logoutLoading ? "Signing out" : "Log out"}
          </button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void onLogin(event)}>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              autoComplete="username"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              disabled={loginLoading || sessionLoading}
              onChange={(event) => onUsernameChange(event.target.value)}
              value={username}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              disabled={loginLoading || sessionLoading}
              onChange={(event) => onPasswordChange(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <button
            className="w-full rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loginLoading || sessionLoading}
            type="submit"
          >
            {loginLoading ? "Signing in" : "Log in"}
          </button>
        </form>
      )}
    </section>
  );
}
