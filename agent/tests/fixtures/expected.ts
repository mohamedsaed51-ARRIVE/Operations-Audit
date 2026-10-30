/**
 * Expected results, computed BY HAND from the tables in generate.ts. Nothing here is produced by the
 * engine under test. Snapshot dates: day1 = 2026-10-20, day2 = 2026-10-21, day3 = 2026-10-22, day4 = 2026-10-25.
 */

export const DAY1 = {
  date: '2026-10-20',
  file: 'inventory_day1_2026-10-20_ar.xlsx',
  // spreadsheet rows below the header: 20 (Excel rows 2–21)
  stats: { totalRows: 20, emptyRows: 1, rejectedRows: 1, ingestedRows: 18, duplicateRows: 1 },
  uniqueShipments: 17,
  /** tracking → [age in days, age category] (null = no valid creation date) */
  ages: {
    EG1001: [0, 'D0_3'], EG1002: [15, 'D8_15'], EG1003: [16, 'D16_25'], EG1004: [25, 'D16_25'], EG1005: [26, 'D26_PLUS'],
    EG1006: [2, 'D0_3'], EG1007: [5, 'D4_7'], EG1008: [4, 'D4_7'], EG1009: [3, 'D0_3'], EG1010: [8, 'D8_15'],
    EG1011: [1, 'D0_3'], EG1012: [1, 'D0_3'], EG1013: [null, null], EG1014: [null, null], EG1015: [10, 'D8_15'],
    EG1016: [1, 'D0_3'], EG1017: [1, 'D0_3'],
  } as Record<string, [number | null, string | null]>,
  byAgeCategory: { D0_3: 7, D4_7: 2, D8_15: 3, D16_25: 2, D26_PLUS: 1, none: 2 },
  overMaxAge: 3, // 16, 25, 26 days — 15 is still compliant
  overCriticalAge: 1, // 26 days — 25 is not critical
  ageUnknown: 2,
  missingEmployee: 1,
  statusAgeUnknown: 17, // first snapshot: no history, no status-entry dates
  issues: {
    EMPTY_ROW: 1, MISSING_TRACKING: 1, MISSING_EMPLOYEE: 1, DUPLICATE_TRACKING: 2, DUPLICATE_CONFLICTING_VALUES: 1,
    INVALID_DATE: 1, FUTURE_DATE: 1, UNKNOWN_STATUS: 1, UNKNOWN_BRANCH: 1, EMPLOYEE_REGISTRY_EMPTY: 1,
  } as Record<string, number>,
  /** Excel row numbers the engine must report. */
  issueRows: {
    EMPTY_ROW: [18], MISSING_TRACKING: [19], MISSING_EMPLOYEE: [12], DUPLICATE_TRACKING: [13, 14], DUPLICATE_CONFLICTING_VALUES: [14],
    INVALID_DATE: [15], FUTURE_DATE: [16], UNKNOWN_STATUS: [20], UNKNOWN_BRANCH: [21],
  } as Record<string, number[]>,
};

export const DAY2 = {
  date: '2026-10-21',
  file: 'inventory_day2_2026-10-21_ar.xlsx',
  uniqueShipments: 17,
  comparison: { NEW: 2, CONTINUED: 15, STATUS_CHANGED: 1, BRANCH_CHANGED: 1, EMPLOYEE_CHANGED: 1, DISAPPEARED: 2, REAPPEARED: 0 },
  changed: { STATUS_CHANGED: ['EG1007'], BRANCH_CHANGED: ['EG1008'], EMPLOYEE_CHANGED: ['EG1009'], NEW: ['EG2001', 'EG2002'], DISAPPEARED: ['EG1010', 'EG1014'] },
  // aging moved one day: 1002→16, 1003→17, 1004→26, 1005→27
  overMaxAge: 4,
  overCriticalAge: 2,
  ages: { EG1002: [16, 'D16_25'], EG1003: [17, 'D16_25'], EG1004: [26, 'D26_PLUS'], EG1005: [27, 'D26_PLUS'], EG1013: [2, 'D0_3'], EG1001: [1, 'D0_3'] } as Record<string, [number, string]>,
  // 14 shipments kept their status since day 1 → observed 1 day; EG1007 (status changed) + 2 new → unknown
  statusAgeObserved: 14,
  statusAgeUnknown: 3,
  statusAgeOf: { EG1001: 1, EG1015: 1, EG1002: 1 } as Record<string, number>,
  statusAgeNull: ['EG1007', 'EG2001', 'EG2002'],
};

export const DAY3 = {
  date: '2026-10-22',
  file: 'inventory_day3_2026-10-22_ar.xlsx',
  uniqueShipments: 6,
  comparison: { NEW: 1, CONTINUED: 4, STATUS_CHANGED: 0, BRANCH_CHANGED: 0, EMPLOYEE_CHANGED: 0, DISAPPEARED: 13, REAPPEARED: 1 },
  reappeared: { tracking: 'EG1010', lastSeenDate: '2026-10-20' },
  // observed unchanged-status duration (lower bound), computed from first sighting of the current status
  statusAgeOf: { EG1001: 2, EG1015: 2, EG1007: 1, EG2001: 1 } as Record<string, number>,
  statusAgeNull: ['EG1010', 'EG3001'],
};

export const DAY4 = {
  date: '2026-10-25',
  file: 'inventory_day4_2026-10-25_en.csv',
  uniqueShipments: 3,
  comparison: { NEW: 1, CONTINUED: 2, STATUS_CHANGED: 0, BRANCH_CHANGED: 0, EMPLOYEE_CHANGED: 2, DISAPPEARED: 4, REAPPEARED: 0 },
  warning: 'SNAPSHOT_GAP',
  daysBetween: 3,
  statusAgeOf: { EG1001: 5, EG1007: 4 } as Record<string, number>,
};

export const BRANCHES = [
  { name: 'القاهرة', governorate: 'القاهرة', aliases: ['Cairo'] },
  { name: 'الجيزة', governorate: 'الجيزة', aliases: ['Giza'] },
  { name: 'الإسكندرية', governorate: 'الإسكندرية', aliases: ['Alexandria'] },
];

/** Full mapping used for the Arabic daily files (column indexes in AR_HEAD). */
export const AR_MAPPING_FIELDS = { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4, governorate: 5, lastUpdateDate: 6 };
export const EN_MAPPING_FIELDS = { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4, governorate: 5 };
