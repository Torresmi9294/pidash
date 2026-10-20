'use strict';
// ESPN's public scoreboard feeds (free, no key; unofficial). key -> [sport, league, label].
// Only team-vs-team sports whose scoreboard has the standard competitor structure.
const LEAGUES = {
  nfl: ['football', 'nfl', 'NFL'],
  nba: ['basketball', 'nba', 'NBA'],
  mlb: ['baseball', 'mlb', 'MLB'],
  nhl: ['hockey', 'nhl', 'NHL'],
  cfb: ['football', 'college-football', 'College Football'],
  cbb: ['basketball', 'mens-college-basketball', "Men's College Basketball"],
  wcbb: ['basketball', 'womens-college-basketball', "Women's College Basketball"],
  wnba: ['basketball', 'wnba', 'WNBA'],
  mls: ['soccer', 'usa.1', 'MLS'],
  nwsl: ['soccer', 'usa.nwsl', 'NWSL'],
  epl: ['soccer', 'eng.1', 'Premier League'],
  ucl: ['soccer', 'uefa.champions', 'Champions League'],
  uel: ['soccer', 'uefa.europa', 'Europa League'],
  laliga: ['soccer', 'esp.1', 'La Liga'],
  bundesliga: ['soccer', 'ger.1', 'Bundesliga'],
  seriea: ['soccer', 'ita.1', 'Serie A'],
  ligue1: ['soccer', 'fra.1', 'Ligue 1'],
  ligamx: ['soccer', 'mex.1', 'Liga MX'],
};

const options = (withNone) => [
  ...(withNone ? [{ value: '', label: 'None' }] : []),
  ...Object.entries(LEAGUES).map(([value, l]) => ({ value, label: l[2] })),
];

module.exports = { LEAGUES, leagueOptions: options };
