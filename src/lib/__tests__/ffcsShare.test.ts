import { describe, it, expect } from 'vitest';
import { PLAN_PREFIX, decodePlan, encodePlan, planCodeVersion } from '../ffcsShare';
import { clashingSectionIds, type PlanSection } from '../ffcsPlanner';

describe('ffcs share codes', () => {
  it('round-trips a plan through encode/decode', () => {
    const plan = [
      { code: 'BAEEE102', title: 'Electrical Circuit Analysis', credits: 4, courseType: 'Theory', day: 'Monday', slot: 'A1', venue: 'SJT 123', faculty: 'Dr. Rao' },
      { code: 'BAPHY106', title: 'Engineering Physics Lab', day: 'Tuesday', slot: 'L7', venue: 'Lab Block 3', faculty: '' },
    ];
    const code = encodePlan(plan);
    const decoded = decodePlan(code);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({ code: 'BAEEE102', day: 'Monday', slot: 'A1', venue: 'SJT 123', faculty: 'Dr. Rao' });
    expect(decoded[0]).toMatchObject({ credits: 4, courseType: 'Theory' });
    expect(decoded[1].venue).toBe('Lab Block 3');
    expect(decoded[1].faculty).toBe('');
  });

  it('decodes planner-generated codes whose day field is empty', () => {
    // FfcsPlannerView encodes PlanSections with day: '' — the slot string is
    // what carries meeting days. This is the exact path Compare uses.
    const code = encodePlan([
      { code: 'BAEEE102', title: 'Electrical Circuit Analysis', credits: 4, courseType: 'Theory', day: '', slot: 'A1+TA1', venue: 'SJT 123', faculty: 'Dr. Rao' },
      { code: 'BAPHY106', title: 'Engineering Physics Lab', day: '', slot: 'L11+L12', venue: 'Lab Block 3', faculty: '' },
    ]);
    const decoded = decodePlan(code);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({ code: 'BAEEE102', day: '', slot: 'A1+TA1', venue: 'SJT 123' });
    expect(decoded[1]).toMatchObject({ code: 'BAPHY106', slot: 'L11+L12' });
  });

  it('detects a clash when comparing a planner-generated friend code', () => {
    const mine: PlanSection[] = [
      { id: 'mine-1', code: 'BAEEE102', title: 'ECA', slot: 'A1+TA1', type: 'Theory', credits: 4, venue: '', faculty: '' },
    ];
    const code = encodePlan([{ code: 'BAMAT202', title: 'Maths', day: '', slot: 'A1', venue: '', faculty: '' }]);
    const decoded = decodePlan(code);
    expect(decoded).toHaveLength(1);
    const friend: PlanSection = {
      id: decoded[0].id, code: decoded[0].code, title: decoded[0].title, slot: decoded[0].slot,
      type: decoded[0].courseType || '', credits: decoded[0].credits ?? 0, venue: decoded[0].venue, faculty: decoded[0].faculty,
    };
    // The friend's A1 overlaps my A1+TA1 — the comparison must flag it.
    expect(clashingSectionIds([...mine, friend]).has(friend.id)).toBe(true);
  });

  it('rejects text without the plan prefix', () => {
    expect(decodePlan('BAEEE102|foo|Monday|A1')).toHaveLength(0);
    expect(decodePlan('')).toHaveLength(0);
    expect(decodePlan(undefined as unknown as string)).toHaveLength(0);
  });

  it('rejects unknown/expired plan-code versions gracefully', () => {
    const v2 = ['ULTRA-FFCS:v2', 'BAEEE102|Circuit Analysis|Monday|A1|SJT 123|'].join('\n');
    expect(decodePlan(v2)).toHaveLength(0);
    expect(planCodeVersion(v2)).toBe('v2');
  });

  it('treats a prefixed code with no readable sections as empty, not as an error', () => {
    const code = [PLAN_PREFIX, 'garbage-line-without-pipes', 'only|two|fields', '| | | |'].join('\n');
    expect(() => decodePlan(code)).not.toThrow();
    expect(decodePlan(code)).toHaveLength(0);
  });

  it('reports the version token for valid and invalid codes', () => {
    expect(planCodeVersion(`${PLAN_PREFIX}\nBAEEE102|x|Monday|A1`)).toBe('v1');
    expect(planCodeVersion('random clipboard text')).toBeNull();
    expect(planCodeVersion('')).toBeNull();
  });

  it('skips malformed lines but keeps valid ones', () => {
    const code = [
      PLAN_PREFIX,
      'BAEEE102|Circuit Analysis|Monday|A1|SJT 123|',
      'garbage-line-without-pipes',
      'BAMAT202|Maths|Wednesday|C1||',
    ].join('\n');
    const decoded = decodePlan(code);
    expect(decoded).toHaveLength(2);
    expect(decoded[0].code).toBe('BAEEE102');
    expect(decoded[1].code).toBe('BAMAT202');
  });

  it('reads legacy codes with only 4 or 6 fields', () => {
    const code = [
      PLAN_PREFIX,
      'BAEEE102|Circuit Analysis|Monday|A1',
      'BAMAT202|Maths|Wednesday|C1|VIT CC',
    ].join('\n');
    const decoded = decodePlan(code);
    expect(decoded).toHaveLength(2);
    expect(decoded[0].slot).toBe('A1');
    expect(decoded[0].venue).toBe('');
    expect(decoded[1].venue).toBe('VIT CC');
  });

  it('trims whitespace and tolerates CRLF line endings', () => {
    const code = `${PLAN_PREFIX}\r\nBAEEE102 |  Circuit Analysis  | Monday | A1 |  |\r\n`;
    const decoded = decodePlan(code);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].title).toBe('Circuit Analysis');
  });
});
