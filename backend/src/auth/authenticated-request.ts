import type { Request } from 'express';
import type { User } from './auth.types';

export interface AuthenticatedRequest extends Request {
  user: User;
}
