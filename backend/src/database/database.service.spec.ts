import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  let databaseService: DatabaseService;

  afterEach(() => {
    databaseService?.close();
  });

  it('uses an in-memory database in tests and seeds demo seats idempotently', () => {
    databaseService = new DatabaseService();

    expect(databaseService.path).toBe(':memory:');
    expect(
      (
        databaseService.connection
          .prepare('SELECT COUNT(*) AS count FROM seats')
          .get() as { count: number }
      ).count,
    ).toBe(3);

    databaseService.connection.exec(`
      INSERT INTO seats (id, label)
      VALUES ('seat-1', 'Seat 1')
      ON CONFLICT(id) DO UPDATE SET label = excluded.label;
    `);

    expect(
      (
        databaseService.connection
          .prepare('SELECT COUNT(*) AS count FROM seats')
          .get() as { count: number }
      ).count,
    ).toBe(3);
  });
});
