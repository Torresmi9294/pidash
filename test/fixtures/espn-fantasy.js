'use strict';
// A small, ESPN-shaped football league (4 teams, week 7) used by the roster/matchup tests and the browser QA.
const PERIOD = 7;
const NAMES = {
  0: ['Patrick Mahomes', 'Josh Allen', 'Jalen Hurts', 'Lamar Jackson'],
  2: ['Christian McCaffrey', 'Saquon Barkley', 'Derrick Henry', 'Bijan Robinson', 'Breece Hall', 'Jahmyr Gibbs', 'Kyren Williams', 'Josh Jacobs'],
  4: ['Justin Jefferson', 'CeeDee Lamb', 'Tyreek Hill', 'Amon-Ra St. Brown', 'Ja\'Marr Chase', 'A.J. Brown', 'Puka Nacua', 'Garrett Wilson'],
  6: ['Travis Kelce', 'Sam LaPorta', 'George Kittle', 'Trey McBride'],
  23: ['Chris Olave', 'Drake London', 'DJ Moore', 'Mike Evans'],
  16: ['Ravens D/ST', 'Bills D/ST', 'Cowboys D/ST', 'Jets D/ST'],
  17: ['Justin Tucker', 'Harrison Butker', 'Brandon Aubrey', 'Jake Elliott'],
  20: ['Rashee Rice', 'Tank Dell', 'Rachaad White', 'Jake Ferguson', 'Zay Flowers', 'James Cook', 'Dalton Kincaid', 'Tony Pollard', 'Joe Burrow', 'Jaylen Waddle', 'DeVonta Smith', 'Aaron Jones'],
  21: ['Nick Chubb', 'Cooper Kupp', 'Rhamondre Stevenson', 'Anthony Richardson'],
};
const DEFPOS = { 0: 1, 2: 2, 4: 3, 6: 4, 23: 3, 16: 16, 17: 5, 20: 2, 21: 2 };
const LINEUP = [0, 2, 2, 4, 4, 6, 23, 16, 17, 20, 20, 20, 21];
const INJ = { 'Justin Jefferson': 'QUESTIONABLE', 'Nick Chubb': 'INJURY_RESERVE', 'Travis Kelce': 'OUT', 'Rashee Rice': 'DOUBTFUL' };

let pid = 1000;
function player(name, slotId, teamIdx, seed) {
  const id = ++pid;
  const dst = slotId === 16;
  const pts = Math.round((((seed * 7 + id) % 230) / 10) * 10) / 10;
  const proj = Math.round((8 + ((seed * 3 + id) % 120) / 10) * 10) / 10;
  return {
    lineupSlotId: slotId,
    playerPoolEntry: {
      id: dst ? -id : id,
      appliedStatTotal: pts, // matchup entries carry the week's points here
      player: {
        id: dst ? -id : id, fullName: name, defaultPositionId: DEFPOS[slotId], proTeamId: 1 + ((id + teamIdx) % 30), injuryStatus: INJ[name] || 'ACTIVE',
        stats: [
          { statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: PERIOD, appliedTotal: pts },
          { statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: PERIOD, appliedTotal: proj },
          { statSourceId: 0, statSplitTypeId: 0, scoringPeriodId: 0, appliedTotal: 999 }, // season line must be ignored
        ],
      },
    },
  };
}

function roster(teamIdx) {
  const used = {};
  return LINEUP.map((slot, k) => {
    used[slot] = (used[slot] || 0) + 1;
    const list = NAMES[slot];
    return player(list[(used[slot] - 1 + teamIdx * 2) % list.length], slot, teamIdx, teamIdx * 13 + k);
  });
}

const TEAMS = [
  { id: 1, name: 'Gridiron Gurus', abbrev: 'GRU', w: 5, l: 1, pf: 812.4 },
  { id: 2, name: 'Fourth & Long Island', abbrev: 'FLI', w: 4, l: 2, pf: 790.2 },
  { id: 3, name: 'Touchdown Tacos', abbrev: 'TAC', w: 3, l: 3, pf: 701.9 },
  { id: 4, name: 'The Waiver Wire Warriors With A Very Long Name', abbrev: 'WWW', w: 1, l: 5, pf: 640.0 },
];

function league({ withRosters = true } = {}) {
  const teams = TEAMS.map((t, i) => ({
    id: t.id, name: t.name, abbrev: t.abbrev, logo: '',
    record: { overall: { wins: t.w, losses: t.l, ties: 0, percentage: t.w / (t.w + t.l), pointsFor: t.pf, streakType: t.w > 3 ? 'WIN' : 'LOSS', streakLength: 2 } },
    roster: withRosters ? { entries: roster(i) } : { entries: [] },
  }));
  const side = (i, pts) => ({ teamId: TEAMS[i].id, totalPoints: pts, rosterForCurrentScoringPeriod: { entries: withRosters ? roster(i) : [] } });
  return {
    scoringPeriodId: PERIOD,
    status: { currentMatchupPeriod: PERIOD },
    settings: { name: 'Sunday Funday League' },
    teams,
    schedule: [
      { matchupPeriodId: PERIOD, home: side(0, 101.4), away: side(1, 96.2) },
      { matchupPeriodId: PERIOD, home: side(2, 0), away: side(3, 0) },
      { matchupPeriodId: PERIOD - 1, home: side(0, 90), away: side(2, 80) },
    ],
  };
}

module.exports = { league, PERIOD, TEAMS };
