/**
 * Runtime checks for the security-hardening migration.
 *
 * These run against an isolated PostgreSQL (PGlite, WASM) built from the real
 * migration files, seeded with rows shaped like production: 24-character
 * uppercase-alphanumeric device tokens, a plaintext token that happens to be
 * 64 lowercase hex characters, and one row already in the new `sha256:` form.
 * Static assertions cannot catch a constraint that does not exist, a view that
 * cannot be read, or a hash that does not match what the RPC computes; these
 * can.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const sql = (name: string) =>
  readFileSync(join(ROOT, 'supabase', 'migrations', name), 'utf8');

const SHARED_MARKS = sql('20261113000001_shared_marks.sql');
const GRADE_PREDICTIONS = sql('20260813000001_grade_predictions.sql');
const HARDENING = sql('20261114000001_security_hardening.sql');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A token of exactly the shape makeDeviceCode() generates (24 characters). */
function device(i: number): string {
  return 'K'.repeat(22) + ALPHABET[Math.floor(i / 32) % 32] + ALPHABET[i % 32];
}

/** The regression case: plaintext that also matches the old "already hashed" regex. */
const HEX_TOKEN = 'a'.repeat(64);
/** A row that a re-run of the hardening migration must leave untouched. */
const PREFIXED_TOKEN = `sha256:${'b'.repeat(64)}`;

const hashOf = (token: string) => `sha256:${sha256Hex(token)}`;

// The same construction the SQL uses; duplicate it here so the test fails if
// the migration switches algorithm or encoding.
function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const COHORT_A = {
  course: 'BEEE203',
  term: 'Fall Semester 2026-27',
  regulation: 'V2025',
  faculty: 'DR. ANITHA',
  slot: 'A1',
  component: 'theory',
  stage: 'internal',
};
const COHORT_B = { ...COHORT_A, term: 'Winter Semester 2026-27' };

interface SeedRow {
  device: string;
  course: string;
  term: string;
  regulation: string;
  faculty: string;
  slot: string;
  component: string;
  stage: string;
  percent: number;
}

function legacyRows(): SeedRow[] {
  const rows: SeedRow[] = [];
  for (let i = 0; i < 14; i += 1) {
    rows.push({ ...COHORT_A, device: device(i), percent: 55 + i });
  }
  rows.push({ ...COHORT_B, device: device(14), percent: 90 });
  rows.push({
    ...COHORT_A,
    device: HEX_TOKEN,
    course: 'BMAT202L',
    percent: 80,
  });
  rows.push({
    ...COHORT_A,
    device: PREFIXED_TOKEN,
    course: 'BCHE201',
    percent: 70,
  });
  return rows;
}

async function seed(db: PGlite, rows: SeedRow[]): Promise<void> {
  for (const row of rows) {
    await db.query(
      `insert into public.shared_marks
         (device_code, course_code, term, regulation, faculty, slot, component, stage, percent, weight)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 30)`,
      [
        row.device,
        row.course,
        row.term,
        row.regulation,
        row.faculty,
        row.slot,
        row.component,
        row.stage,
        row.percent,
      ],
    );
  }
}

/**
 * Build a database that looks like production before the hardening migration:
 * Supabase's anon/authenticated roles, the two earlier migrations, a
 * cabshare_rides table carrying the old doubled-backslash check, and legacy
 * shared_marks rows.
 */
async function productionSnapshot(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated;');
  await db.exec(SHARED_MARKS);
  await db.exec(GRADE_PREDICTIONS);
  // Supabase grants anon/authenticated ALL on every table created in `public`
  // through its default privileges. The old grade_predictions migration never
  // revoked them, so the snapshot carries them and the hardening migration has
  // to be the thing that removes them.
  await db.exec(`
    grant all on public.grade_predictions to anon, authenticated;
    grant usage, select on sequence public.grade_predictions_id_seq to anon, authenticated;
  `);
  await db.exec(`
    create table public.cabshare_rides (
      id          bigint generated always as identity primary key,
      travel_date text not null,
      travel_time text not null
    );
    alter table public.cabshare_rides
      add constraint cabshare_datetime_format_check check (
        travel_date ~ '^\\\\d{4}-\\\\d{2}-\\\\d{2}$'
        and travel_time ~ '^([01]\\\\d|2[0-3]):[0-5]\\\\d$'
      ) not valid;
  `);
  await seed(db, legacyRows());
  return db;
}

const count = async (db: PGlite, query: string, params: unknown[] = []): Promise<number> => {
  const result = await db.query<{ n: number }>(query, params);
  return Number(result.rows[0].n);
};

describe('shared_marks RPCs on a real PostgreSQL', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await productionSnapshot();
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  it('declares the dedupe constraint with the name and columns the RPC targets', async () => {
    const result = await db.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'public.shared_marks'::regclass and contype = 'u'`,
    );
    expect(result.rows).toEqual([
      {
        conname: 'shared_marks_one_per_device',
        def: 'UNIQUE (device_code, course_code, term, component)',
      },
    ]);
  });

  it('has not yet hashed anything in the pre-migration snapshot', async () => {
    expect(
      await count(db, `select count(*)::int as n from public.shared_marks where device_code !~ '^sha256:'`),
    ).toBe(16);
  });

  it('hashes every legacy token, including the 64-hex plaintext, and keeps the prefixed row', async () => {
    await db.exec(HARDENING);

    expect(
      await count(db, `select count(*)::int as n from public.shared_marks where device_code !~ '^sha256:[0-9a-f]{64}$'`),
    ).toBe(0);

    // Every seeded plaintext resolves to the stored value the RPC will compute.
    // The already-prefixed row is odd on purpose and is checked separately.
    for (const row of legacyRows().filter((seed) => !seed.device.startsWith('sha256:'))) {
      expect(
        await count(
          db,
          `select count(*)::int as n from public.shared_marks
            where device_code = 'sha256:' || encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
          [row.device],
        ),
      ).toBe(1);
    }

    // The prefixed row is left alone rather than hashed a second time.
    expect(
      await count(db, `select count(*)::int as n from public.shared_marks where device_code = $1`, [PREFIXED_TOKEN]),
    ).toBe(1);
  });

  it('is idempotent: a re-run changes no stored token', async () => {
    const before = await db.query<{ device_code: string }>(
      `select device_code from public.shared_marks order by id`,
    );
    await db.exec(HARDENING);
    const after = await db.query<{ device_code: string }>(
      `select device_code from public.shared_marks order by id`,
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('removes the grade_predictions privileges anon inherited, but keeps the RPCs callable', async () => {
    const privileges = await db.query<{
      anon_insert: boolean;
      anon_select: boolean;
      auth_insert: boolean;
      auth_delete: boolean;
    }>(
      `select
         has_table_privilege('anon', 'public.grade_predictions', 'INSERT')       as anon_insert,
         has_table_privilege('anon', 'public.grade_predictions', 'SELECT')       as anon_select,
         has_table_privilege('authenticated', 'public.grade_predictions', 'INSERT') as auth_insert,
         has_table_privilege('authenticated', 'public.grade_predictions', 'DELETE') as auth_delete`,
    );
    expect(privileges.rows[0]).toEqual({
      anon_insert: false,
      anon_select: false,
      auth_insert: false,
      auth_delete: false,
    });

    expect(
      await count(
        db,
        `select case when has_function_privilege(
           'anon',
           'public.share_marks(text,text,text,text,text,text,text,text,numeric,numeric)',
           'execute') then 1 else 0 end as n`,
      ),
    ).toBe(1);
  });

  it('upserts on the declared constraint instead of duplicating a sync', async () => {
    const token = device(0);
    const hashed = hashOf(token);

    for (const percent of [66, 71, 74]) {
      await db.query(
        `select public.share_marks($1, $2, $3, $4, $5, $6, 'theory', 'internal', $7, 30)`,
        [token, COHORT_A.course, COHORT_A.term, COHORT_A.regulation, COHORT_A.faculty, COHORT_A.slot, percent],
      );
    }

    const result = await db.query<{ n: number; percent: string }>(
      `select count(*)::int as n, max(percent)::text as percent
         from public.shared_marks where device_code = $1`,
      [hashed],
    );
    expect(Number(result.rows[0].n)).toBe(1);
    expect(Number(result.rows[0].percent)).toBe(74);

    // A different component is a different contribution.
    await db.query(
      `select public.share_marks($1, $2, $3, $4, $5, $6, 'lab', 'internal', 80, 20)`,
      [token, COHORT_A.course, COHORT_A.term, COHORT_A.regulation, COHORT_A.faculty, COHORT_A.slot],
    );
    expect(await count(db, `select count(*)::int as n from public.shared_marks where device_code = $1`, [hashed])).toBe(2);

    // The conflict key is (device, course, term, component): a re-sync that
    // moves the class to another faculty/slot/stage updates this row.
    const moved = device(70);
    await db.query(
      `select public.share_marks($1, 'BTEST101', 'Term', 'V2025', 'DR A', 'A1', 'theory', 'internal', 40, 20)`,
      [moved],
    );
    await db.query(
      `select public.share_marks($1, 'BTEST101', 'Term', 'V2025', 'DR B', 'B2', 'theory', 'final', 65, 20)`,
      [moved],
    );
    const row = await db.query<{ faculty: string; slot: string; stage: string; percent: string }>(
      `select faculty, slot, stage, percent::text as percent
         from public.shared_marks where device_code = $1 and course_code = 'BTEST101'`,
      [hashOf(moved)],
    );
    expect(row.rows).toEqual([{ faculty: 'DR B', slot: 'B2', stage: 'final', percent: '65.00' }]);
  });

  it('does not pool two terms of the same course', async () => {
    const result = await db.query<{ term: string; n: string }>(
      `select term, contributor_count::text as n from public.grade_stats order by term`,
    );
    // Only a class with 15 contributors is described; 14 + 1 across two terms
    // is not 15.
    for (const row of result.rows) expect(Number(row.n)).toBeGreaterThanOrEqual(15);
    const terms = result.rows.map((row) => row.term);
    expect(terms).not.toContain(COHORT_B.term);
  });

  it('applies the privacy floor per cohort and lifts it at exactly 15', async () => {
    const params = [
      COHORT_A.course,
      COHORT_A.term,
      COHORT_A.regulation,
      COHORT_A.faculty,
      COHORT_A.slot,
      COHORT_A.component,
      COHORT_A.stage,
    ];

    const below = await db.query<{ c: string; sup: string }>(
      `select s->>'count' as c, s->>'suppressed' as sup
         from (select public.shared_marks_stats($1, $2, $3, $4, $5, $6, $7) as s) q`,
      params,
    );
    // Cohort A had 14 legacy rows, plus a lab row for device 0 that does not
    // count here, minus nothing yet.
    expect(Number(below.rows[0].c)).toBe(14);
    expect(below.rows[0].sup).toBe('true');

    await db.query(
      `select public.share_marks($1, $2, $3, $4, $5, $6, 'theory', 'internal', 88, 30)`,
      [device(40), COHORT_A.course, COHORT_A.term, COHORT_A.regulation, COHORT_A.faculty, COHORT_A.slot],
    );

    const at = await db.query<{ c: string; sup: string }>(
      `select s->>'count' as c, s->>'suppressed' as sup
         from (select public.shared_marks_stats($1, $2, $3, $4, $5, $6, $7) as s) q`,
      params,
    );
    expect(Number(at.rows[0].c)).toBe(15);
    expect(at.rows[0].sup).toBe('false');

    const view = await db.query<{ n: number }>(
      `select count(*)::int as n from public.grade_stats where course_code = $1 and term = $2`,
      [COHORT_A.course, COHORT_A.term],
    );
    expect(Number(view.rows[0].n)).toBe(1);
  });

  it('withdraws only the calling device, through the hashed token', async () => {
    const token = device(5);
    const result = await db.query<{ removed: string }>(
      `select public.withdraw_marks($1)->>'removed' as removed`,
      [token],
    );
    expect(Number(result.rows[0].removed)).toBe(1);
    expect(
      await count(db, `select count(*)::int as n from public.shared_marks where device_code = $1`, [hashOf(token)]),
    ).toBe(0);

    // The 64-hex legacy token withdraws the same way.
    const hexRemoved = await db.query<{ removed: string }>(
      `select public.withdraw_marks($1)->>'removed' as removed`,
      [HEX_TOKEN],
    );
    expect(Number(hexRemoved.rows[0].removed)).toBe(1);

    // Withdrawal drops the cohort below the floor again, and the view agrees.
    const view = await db.query<{ n: number }>(
      `select count(*)::int as n from public.grade_stats where course_code = $1 and term = $2`,
      [COHORT_A.course, COHORT_A.term],
    );
    expect(Number(view.rows[0].n)).toBe(0);
  });

  it('rejects a plaintext token that bypasses the RPCs', async () => {
    await expect(
      db.query(
        `insert into public.shared_marks
           (device_code, course_code, term, regulation, faculty, slot, component, stage, percent, weight)
         values ('PLAINTEXTTOKEN1234567890', 'BEEE203', 'T', 'V2025', '', '', 'theory', 'internal', 50, 10)`,
      ),
    ).rejects.toThrow(/shared_marks_device_code_hashed/);
  });

  it('refuses an empty cohort label and a short token', async () => {
    await expect(
      db.query(
        `select public.share_marks($1, 'BEEE203', '', 'V2025', '', '', 'theory', 'internal', 50, 10)`,
        [device(60)],
      ),
    ).rejects.toThrow(/MARKS_INVALID_TERM/);
    await expect(
      db.query(`select public.withdraw_marks('short')`),
    ).rejects.toThrow(/MARKS_INVALID_DEVICE/);
  });

  it('denies anonymous table access but keeps the aggregate readable', async () => {
    await db.exec('set role anon');

    await expect(db.query('select count(*) from public.shared_marks')).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `insert into public.shared_marks
           (device_code, course_code, term, regulation, faculty, slot, component, stage, percent, weight)
         values ('PLAINTEXTTOKEN1234567890', 'BEEE203', 'T', 'V2025', '', '', 'theory', 'internal', 50, 10)`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query('select count(*) from public.grade_predictions')).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `insert into public.grade_predictions (course_id, total_marks, final_grade)
         values ('BEEE203', 70, 'B')`,
      ),
    ).rejects.toThrow(/permission denied/);

    const view = await db.query<{ n: number }>(
      `select count(*)::int as n from public.grade_stats where course_code = $1`,
      [COHORT_A.course],
    );
    // The withdrawal above put the class back under the floor; the readable
    // view simply has nothing to say about it.
    expect(Number(view.rows[0].n)).toBe(0);

    const stats = await db.query<{ c: string; sup: string }>(
      `select s->>'count' as c, s->>'suppressed' as sup
         from (select public.shared_marks_stats($1, $2, $3, $4, $5, 'theory', 'internal') as s) q`,
      [COHORT_A.course, COHORT_A.term, COHORT_A.regulation, COHORT_A.faculty, COHORT_A.slot],
    );
    expect(Number(stats.rows[0].c)).toBe(14);
    expect(stats.rows[0].sup).toBe('true');

    await db.exec('reset role');
  });

  it('accepts a real date after the backslash fix and rejected it before', async () => {
    // Before: the doubled-backslash regex demanded a literal backslash.
    const fresh = new PGlite();
    try {
      await fresh.exec('create role anon; create role authenticated;');
      await fresh.exec(SHARED_MARKS);
      await fresh.exec(GRADE_PREDICTIONS);
      await fresh.exec(`
        create table public.cabshare_rides (
          id bigint generated always as identity primary key,
          travel_date text not null,
          travel_time text not null
        );
        alter table public.cabshare_rides
          add constraint cabshare_datetime_format_check check (
            travel_date ~ '^\\\\d{4}-\\\\d{2}-\\\\d{2}$'
            and travel_time ~ '^([01]\\\\d|2[0-3]):[0-5]\\\\d$'
          ) not valid;
      `);
      await expect(
        fresh.query(`insert into public.cabshare_rides (travel_date, travel_time) values ('2026-11-14', '09:30')`),
      ).rejects.toThrow(/cabshare_datetime_format_check/);

      await fresh.exec(HARDENING);
      await fresh.query(
        `insert into public.cabshare_rides (travel_date, travel_time) values ('2026-11-14', '09:30')`,
      );
      await expect(
        fresh.query(`insert into public.cabshare_rides (travel_date, travel_time) values ('14/11/2026', '09:30')`),
      ).rejects.toThrow(/cabshare_datetime_format_check/);
    } finally {
      await fresh.close();
    }
  }, 30_000);
});

describe('rollback and recovery', () => {
  it('leaves the table unchanged when the migration transaction is rolled back', async () => {
    const db = await productionSnapshot();
    try {
      await db.exec('begin');
      await db.exec(HARDENING);
      expect(
        await count(db, `select count(*)::int as n from public.shared_marks where device_code !~ '^sha256:'`),
      ).toBe(0);
      await db.exec('rollback');

      expect(
        await count(db, `select count(*)::int as n from public.shared_marks where device_code !~ '^sha256:'`),
      ).toBe(16);

      // Recovery: the same migration applies cleanly to the restored state.
      await db.exec(HARDENING);
      expect(
        await count(db, `select count(*)::int as n from public.shared_marks where device_code !~ '^sha256:[0-9a-f]{64}$'`),
      ).toBe(0);
    } finally {
      await db.close();
    }
  }, 60_000);
});
