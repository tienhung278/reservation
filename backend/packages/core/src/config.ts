export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }

  return parsed;
}

export function booleanEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
