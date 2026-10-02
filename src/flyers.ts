import fetch from 'node-fetch';
import cron from 'node-cron';
import type { ChatInputCommandInteraction, Client } from 'discord.js';

const API = 'https://api-web.nhle.com';
const TEAM = 'PHI';
const TZ = 'America/New_York';
const POLL_MS = 30_000; // how often to poll a live game
const MAX_POLL_MS = 5 * 60 * 60 * 1000; // safety cap so a stuck game can't poll forever
export const FINAL_STATES = new Set(['OFF', 'FINAL']);

/* ---------- types (only the fields we use) ---------- */

export type TeamRef = { id: number; abbrev: string; score?: number };

export type ScheduleGame = {
  id: number;
  gameDate: string; // YYYY-MM-DD
  startTimeUTC: string;
  gameState: string;
  awayTeam: TeamRef;
  homeTeam: TeamRef;
};

export type ClubSchedule = { previousSeason?: number; games: ScheduleGame[] };

export type Play = {
  eventId: number;
  typeDescKey: string;
  timeInPeriod: string;
  periodDescriptor: { number: number; periodType: string };
  details?: {
    eventOwnerTeamId?: number;
    scoringPlayerId?: number;
    assist1PlayerId?: number;
    assist2PlayerId?: number;
    awayScore?: number;
    homeScore?: number;
    highlightClipSharingUrl?: string;
  };
};

export type PlayByPlay = {
  id: number;
  gameState: string;
  awayTeam: TeamRef;
  homeTeam: TeamRef;
  gameOutcome?: { lastPeriodType?: string };
  rosterSpots: { playerId: number; firstName: { default: string }; lastName: { default: string } }[];
  plays: Play[];
};

/* ---------- state ---------- */

// Keys like "<gameId>-<eventId>". Cleared by the 3am job.
const postedEvents = new Set<string>();
// Games we already have a timer or poller for, so restarts/reruns don't double up.
const scheduledGames = new Set<number>();

/* ---------- helpers ---------- */

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

// YYYY-MM-DD in Eastern time (handles EST/EDT automatically)
export function etDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

function flyersTeamId(game: { homeTeam: TeamRef; awayTeam: TeamRef }): number {
  return game.homeTeam.abbrev === TEAM ? game.homeTeam.id : game.awayTeam.id;
}

// Shootout "goals" are excluded; they aren't real goals and have no clips.
export function getFlyersGoals(pbp: PlayByPlay): Play[] {
  const id = flyersTeamId(pbp);
  return pbp.plays.filter(
    (p) =>
      p.typeDescKey === 'goal' &&
      p.details?.eventOwnerTeamId === id &&
      p.periodDescriptor.periodType !== 'SO'
  );
}

export function formatGoal(pbp: PlayByPlay, play: Play): string {
  const d = play.details ?? {};
  const name = (id?: number) => {
    if (!id) return undefined;
    const p = pbp.rosterSpots.find((r) => r.playerId === id);
    return p ? `${p.firstName.default} ${p.lastName.default}` : undefined;
  };

  const scorer = name(d.scoringPlayerId) ?? 'Unknown';
  const assists = [name(d.assist1PlayerId), name(d.assist2PlayerId)].filter(Boolean);
  const { number, periodType } = play.periodDescriptor;
  const period = periodType === 'REG' ? `P${number}` : periodType;
  const score = `${pbp.awayTeam.abbrev} ${d.awayScore ?? '?'} - ${d.homeScore ?? '?'} ${pbp.homeTeam.abbrev}`;

  let msg = `🚨 **FLYERS GOAL!** ${scorer}`;
  msg += assists.length ? ` (assists: ${assists.join(', ')})` : ' (unassisted)';
  msg += `\n${period} ${play.timeInPeriod} | ${score}`;
  if (d.highlightClipSharingUrl) msg += `\n${d.highlightClipSharingUrl}`;
  return msg;
}

export function formatFinal(pbp: PlayByPlay): string {
  // Prefer the team scores; fall back to the last goal's running score.
  const lastGoal = [...pbp.plays].reverse().find((p) => p.typeDescKey === 'goal' && p.details?.awayScore !== undefined);
  const away = pbp.awayTeam.score ?? lastGoal?.details?.awayScore;
  const home = pbp.homeTeam.score ?? lastGoal?.details?.homeScore;
  const type = pbp.gameOutcome?.lastPeriodType;
  const suffix = type === 'OT' || type === 'SO' ? ` (${type})` : '';

  let msg = `🏁 **FINAL${suffix}:** ${pbp.awayTeam.abbrev} ${away ?? '?'} - ${home ?? '?'} ${pbp.homeTeam.abbrev}`;
  if (typeof away === 'number' && typeof home === 'number') {
    const flyersHome = pbp.homeTeam.abbrev === TEAM;
    const flyers = flyersHome ? home : away;
    const opp = flyersHome ? away : home;
    msg += flyers > opp ? '\nFlyers win! 🧡' : '\nFlyers fall this time.';
  }
  return msg;
}

/* ---------- live tracking ---------- */

async function getSendableChannel(client: Client, channelId: string) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    console.error(`Channel ${channelId} is not a sendable text channel`);
    return null;
  }
  return channel;
}

async function postFinalScore(client: Client, channelId: string, pbp: PlayByPlay) {
  const channel = await getSendableChannel(client, channelId);
  if (channel) await channel.send(formatFinal(pbp));
}

// Drop this game's entries from the dedupe cache once it's over.
function clearGameCache(gameId: number) {
  for (const key of postedEvents) {
    if (key.startsWith(`${gameId}-`)) postedEvents.delete(key);
  }
}

async function postNewGoals(client: Client, channelId: string, pbp: PlayByPlay, finalPass: boolean) {
  const channel = await getSendableChannel(client, channelId);
  if (!channel) return;

  for (const goal of getFlyersGoals(pbp)) {
    const key = `${pbp.id}-${goal.eventId}`;
    if (postedEvents.has(key)) continue;

    // The clip usually shows up a minute or so after the goal. Wait for it,
    // unless the game is over, in which case post whatever is left.
    if (!goal.details?.highlightClipSharingUrl && !finalPass) continue;

    postedEvents.add(key);
    await channel.send(formatGoal(pbp, goal));
  }
}

async function pollGame(client: Client, channelId: string, gameId: number) {
  const startedAt = Date.now();

  const tick = async () => {
    try {
      const pbp = await getJson<PlayByPlay>(`/v1/gamecenter/${gameId}/play-by-play`);
      const finished = FINAL_STATES.has(pbp.gameState);

      await postNewGoals(client, channelId, pbp, finished);

      if (finished) {
        await postFinalScore(client, channelId, pbp);
        clearGameCache(gameId);
        console.log(`Game ${gameId} finished, final score posted, cache cleared, polling stopped.`);
        return;
      }
    } catch (err) {
      console.error(`Poll error for game ${gameId}:`, err);
    }

    if (Date.now() - startedAt > MAX_POLL_MS) {
      console.warn(`Game ${gameId} hit the poll time cap, stopping.`);
      return;
    }
    setTimeout(tick, POLL_MS);
  };

  await tick();
}

async function scheduleTodaysGames(client: Client, channelId: string) {
  try {
    const { games } = await getJson<ClubSchedule>(`/v1/club-schedule-season/${TEAM}/now`);
    const today = etDate(new Date());

    const todays = games.filter(
      (g) => etDate(new Date(g.startTimeUTC)) === today && !FINAL_STATES.has(g.gameState)
    );

    for (const game of todays) {
      if (scheduledGames.has(game.id)) continue;
      scheduledGames.add(game.id);

      // If the bot restarts mid-game the delay is 0 and polling starts right away.
      const delay = Math.max(0, Date.parse(game.startTimeUTC) - Date.now());
      console.log(
        `Scheduling ${game.awayTeam.abbrev} @ ${game.homeTeam.abbrev} (${game.id}), polling in ${Math.round(delay / 60000)} min`
      );
      setTimeout(() => void pollGame(client, channelId, game.id), delay);
    }
  } catch (err) {
    console.error('Failed to schedule today\'s Flyers games:', err);
  }
}

export function startFlyersTracker(client: Client, channelId: string) {
  cron.schedule(
    '0 3 * * *',
    () => {
      postedEvents.clear();
      scheduledGames.clear();
      void scheduleTodaysGames(client, channelId);
    },
    { timezone: TZ }
  );

  // Also run once on startup so a restart mid-day still picks up tonight's game.
  void scheduleTodaysGames(client, channelId);
}

/* ---------- manual command ---------- */

async function findLatestCompletedGame(): Promise<ScheduleGame | undefined> {
  const pickLatest = (games: ScheduleGame[]) =>
    games
      .filter((g) => FINAL_STATES.has(g.gameState))
      .sort((a, b) => Date.parse(b.startTimeUTC) - Date.parse(a.startTimeUTC))[0];

  const current = await getJson<ClubSchedule>(`/v1/club-schedule-season/${TEAM}/now`);
  const latest = pickLatest(current.games);
  if (latest || !current.previousSeason) return latest;

  // Season hasn't produced a finished game yet, fall back to last season.
  const previous = await getJson<ClubSchedule>(`/v1/club-schedule-season/${TEAM}/${current.previousSeason}`);
  return pickLatest(previous.games);
}

export async function handleFlyersHighlights(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    const game = await findLatestCompletedGame();
    if (!game) {
      await interaction.editReply('Could not find a completed Flyers game.');
      return;
    }

    const pbp = await getJson<PlayByPlay>(`/v1/gamecenter/${game.id}/play-by-play`);
    const goals = getFlyersGoals(pbp);
    const matchup = `${pbp.awayTeam.abbrev} @ ${pbp.homeTeam.abbrev}`;

    if (goals.length === 0) {
      await interaction.editReply(`No Flyers goals in ${matchup} (${game.gameDate}).`);
      return;
    }

    await interaction.editReply(`🏒 Flyers goals from ${matchup} (${game.gameDate}):`);
    // followUp posts into the channel the command was used in.
    for (const goal of goals) {
      await interaction.followUp(formatGoal(pbp, goal));
    }
  } catch (err) {
    console.error('flyers_highlights failed:', err);
    await interaction.editReply('Could not reach the NHL API, try again in a bit.');
  }
}