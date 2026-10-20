/** Sign in to save and share projects on this server. */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { login } from '../api/auth';
import { ProviderError } from '../providers/backend';
import { Button } from './primitives';

export function LoginDialog({
  open,
  onClose,
  onSignedIn,
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn: (username: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { user: useId(), pass: useId(), err: useId() };
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
    if (!open) {
      setPassword('');
      setError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await login(username.trim(), password);
      setPassword('');
      onSignedIn(s.username);
    } catch (err) {
      setError(err instanceof ProviderError ? err.message : 'Sign-in failed: the server is not reachable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="login-title"
      className="m-auto w-[min(24rem,92vw)] rounded border border-slate-400 p-0 backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="p-4" aria-describedby={error ? ids.err : undefined}>
        <h2 id="login-title" className="mb-1 text-lg font-semibold">
          Sign in to save on the server
        </h2>
        <p className="mb-3 text-sm text-slate-700">
          Saving and sharing links need the server login. Editing in this browser does not, and anyone with a
          share link can view it.
        </p>
        {error && (
          <p id={ids.err} role="alert" className="mb-2 rounded border-2 border-red-700 bg-red-50 p-2 text-sm">
            ⛔ {error}
          </p>
        )}
        <label htmlFor={ids.user} className="block text-xs font-medium">
          Username
        </label>
        <input
          id={ids.user}
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mb-2 w-full rounded border border-slate-500 px-2 py-1"
        />
        <label htmlFor={ids.pass} className="block text-xs font-medium">
          Password
        </label>
        <input
          id={ids.pass}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded border border-slate-500 px-2 py-1"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
