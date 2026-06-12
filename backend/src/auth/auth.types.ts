export interface User {
  id: string;
  username: string;
}

export interface Session {
  id: string;
  user: User;
  expiresAt: string;
}

export interface LoginDto {
  username?: unknown;
  password?: unknown;
}
