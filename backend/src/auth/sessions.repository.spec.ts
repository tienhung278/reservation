import { DatabaseService } from '../database/database.service';
import { Session } from './auth.types';
import { SessionsRepository } from './sessions.repository';

describe('SessionsRepository', () => {
  let databaseService: DatabaseService;
  let repository: SessionsRepository;

  beforeEach(() => {
    databaseService = new DatabaseService();
    repository = new SessionsRepository(databaseService);
  });

  afterEach(() => {
    databaseService.close();
  });

  it('creates and finds a session with mapped user fields', async () => {
    const session: Session = {
      id: 'session-1',
      user: {
        id: 'user-1',
        username: 'demo@example.com',
      },
      expiresAt: '2026-01-01T01:00:00.000Z',
    };

    await repository.create(session);

    await expect(repository.findById(session.id)).resolves.toEqual(session);
  });

  it('returns undefined for missing and deleted sessions', async () => {
    const session: Session = {
      id: 'session-1',
      user: {
        id: 'user-1',
        username: 'demo@example.com',
      },
      expiresAt: '2026-01-01T01:00:00.000Z',
    };

    await expect(
      repository.findById('missing-session'),
    ).resolves.toBeUndefined();

    await repository.create(session);
    await repository.deleteById(session.id);

    await expect(repository.findById(session.id)).resolves.toBeUndefined();
  });
});
