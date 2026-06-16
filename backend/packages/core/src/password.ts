import argon2 from 'argon2';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

let dummyHashPromise: Promise<string> | undefined;

export async function hashPassword(password: string): Promise<string> {
  return await argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return await argon2.verify(passwordHash, password);
}

export async function verifyPasswordOrDummy(input: {
  passwordHash?: string;
  password: string;
}): Promise<boolean> {
  const passwordHash = input.passwordHash ?? (await getDummyHash());
  const verified = await verifyPassword(passwordHash, input.password);

  return Boolean(input.passwordHash && verified);
}

async function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('not-the-real-password');
  return await dummyHashPromise;
}
