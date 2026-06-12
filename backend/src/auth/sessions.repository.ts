import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { sessions } from '../database/schema';
import { Session } from './auth.types';

@Injectable()
export class SessionsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(session: Session): Promise<void> {
    await this.databaseService.db
      .insert(sessions)
      .values({
        id: session.id,
        userId: session.user.id,
        username: session.user.username,
        expiresAt: session.expiresAt,
      })
      .run();
  }

  async deleteById(sessionId: string): Promise<void> {
    await this.databaseService.db
      .delete(sessions)
      .where(eq(sessions.id, sessionId))
      .run();
  }

  async findById(sessionId: string): Promise<Session | undefined> {
    const session = await this.databaseService.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();

    if (!session) {
      return undefined;
    }

    return {
      id: session.id,
      user: {
        id: session.userId,
        username: session.username,
      },
      expiresAt: session.expiresAt,
    };
  }
}
