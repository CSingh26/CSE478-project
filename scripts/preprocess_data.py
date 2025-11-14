from __future__ import annotations

import csv
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Tuple

DATA_DIR = Path("data")
OUTPUT_DIR = Path("public/data")


def _to_float(value: str) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def load_game_seasons() -> Dict[str, int]:
    mapping: Dict[str, int] = {}
    with (DATA_DIR / "games.csv").open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            game_id = row["GAME_ID"]
            try:
                season = int(row["SEASON"])
            except (TypeError, ValueError):
                continue
            mapping[game_id] = season
    return mapping


@dataclass
class TeamGameTotals:
    season: int
    team_id: str
    fgm: float = 0.0
    fga: float = 0.0
    fg3m: float = 0.0
    fg3a: float = 0.0
    ftm: float = 0.0
    fta: float = 0.0
    pts: float = 0.0
    games: int = 0

    def add_row(self, row: dict) -> None:
        self.fgm += _to_float(row.get("FGM"))
        self.fga += _to_float(row.get("FGA"))
        self.fg3m += _to_float(row.get("FG3M"))
        self.fg3a += _to_float(row.get("FG3A"))
        self.ftm += _to_float(row.get("FTM"))
        self.fta += _to_float(row.get("FTA"))
        self.pts += _to_float(row.get("PTS"))


def aggregate_team_games(game_seasons: Dict[str, int]) -> Dict[Tuple[str, str], TeamGameTotals]:
    totals: Dict[Tuple[str, str], TeamGameTotals] = {}
    details_path = DATA_DIR / "games_details.csv"

    with details_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            game_id = row["GAME_ID"]
            team_id = row["TEAM_ID"]
            season = game_seasons.get(game_id)
            if season is None or season < 2000:
                continue
            key = (game_id, team_id)
            if key not in totals:
                totals[key] = TeamGameTotals(season=season, team_id=team_id)
            totals[key].add_row(row)

    # finalize games count
    for record in totals.values():
        record.games = 1

    return totals


def aggregate_seasons(team_games: Dict[Tuple[str, str], TeamGameTotals]):
    season_sums = defaultdict(lambda: defaultdict(float))
    team_season_sums: Dict[Tuple[int, str], Dict[str, float]] = defaultdict(lambda: defaultdict(float))

    for stats in team_games.values():
        season = stats.season
        key = (season, stats.team_id)

        components = {
            "fgm": stats.fgm,
            "fga": stats.fga,
            "fg3m": stats.fg3m,
            "fg3a": stats.fg3a,
            "ftm": stats.ftm,
            "fta": stats.fta,
            "pts": stats.pts,
            "two_points": max(stats.fgm - stats.fg3m, 0.0) * 2,
            "three_points": stats.fg3m * 3,
            "ft_points": stats.ftm,
        }

        for name, value in components.items():
            season_sums[season][name] += value
            team_season_sums[key][name] += value

        season_sums[season]["team_games"] += stats.games
        team_season_sums[key]["games"] += stats.games

    return season_sums, team_season_sums


def load_team_metadata() -> Dict[str, dict]:
    metadata: Dict[str, dict] = {}
    with (DATA_DIR / "teams.csv").open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            metadata[row["TEAM_ID"]] = {
                "nickname": row.get("NICKNAME", "").strip(),
                "city": row.get("CITY", "").strip(),
                "abbr": row.get("ABBREVIATION", "").strip(),
            }
    return metadata


def load_rankings() -> Dict[Tuple[int, str], dict]:
    ranking_file = DATA_DIR / "ranking.csv"
    best_rows: Dict[Tuple[int, str], dict] = {}
    with ranking_file.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            team_id = row["TEAM_ID"]
            season_id = row.get("SEASON_ID", "")
            if not season_id:
                continue
            season = int(str(season_id)[-4:])
            if season < 2000:
                continue
            date_raw = row.get("STANDINGSDATE", "")
            try:
                standings_date = datetime.strptime(date_raw, "%Y-%m-%d")
            except ValueError:
                continue
            key = (season, team_id)
            previous = best_rows.get(key)
            if previous is None or standings_date >= previous["__date"]:
                row_copy = dict(row)
                row_copy["__date"] = standings_date
                best_rows[key] = row_copy
    results = {}
    for key, row in best_rows.items():
        wins = float(row.get("W") or 0)
        losses = float(row.get("L") or 0)
        total = wins + losses
        win_pct = wins / total if total else None
        results[key] = {
            "conference": row.get("CONFERENCE", "").strip(),
            "team": row.get("TEAM", "").strip(),
            "wins": wins,
            "losses": losses,
            "win_pct": win_pct,
        }
    return results


def build_league_trends(season_sums: Dict[int, dict]) -> list:
    records = []
    for season in sorted(season_sums):
        totals = season_sums[season]
        team_games = totals.get("team_games", 0) or 1
        fg3a = totals.get("fg3a", 0)
        fga = totals.get("fga", 0)
        fg3m = totals.get("fg3m", 0)
        pts = totals.get("pts", 0)

        record = {
            "season": season,
            "avgThreeAttempts": round(fg3a / team_games, 3),
            "avgThreeRate": round(fg3a / fga, 4) if fga else 0,
            "avgPoints": round(pts / team_games, 3),
            "avgThreePct": round(fg3m / fg3a, 4) if fg3a else 0,
            "teamGames": int(team_games),
        }
        records.append(record)
    return records


def build_scoring_mix(season_sums: Dict[int, dict]) -> list:
    records = []
    for season in sorted(season_sums):
        totals = season_sums[season]
        two_pts = totals.get("two_points", 0)
        three_pts = totals.get("three_points", 0)
        ft_pts = totals.get("ft_points", 0)
        total_points = two_pts + three_pts + ft_pts
        if not total_points:
            continue
        records.append(
            {
                "season": season,
                "twoPct": round(two_pts / total_points, 4),
                "threePct": round(three_pts / total_points, 4),
                "ftPct": round(ft_pts / total_points, 4),
            }
        )
    return records


def build_team_scatter(
    team_season_sums: Dict[Tuple[int, str], Dict[str, float]],
    team_meta: Dict[str, dict],
    rankings: Dict[Tuple[int, str], dict],
) -> list:
    records = []
    for (season, team_id), totals in team_season_sums.items():
        if season < 2010:
            continue
        games = totals.get("games", 0) or 1
        fg3a = totals.get("fg3a", 0)
        fg3m = totals.get("fg3m", 0)
        fga = totals.get("fga", 0)
        meta = team_meta.get(team_id, {})
        ranking = rankings.get((season, team_id), {})
        record = {
            "season": season,
            "teamId": team_id,
            "team": meta.get("nickname") or ranking.get("team") or "",
            "city": meta.get("city", ""),
            "abbr": meta.get("abbr", ""),
            "conference": ranking.get("conference", ""),
            "avgThreeAttempts": round(fg3a / games, 3),
            "threePct": round(fg3m / fg3a, 4) if fg3a else 0,
            "threeRate": round(fg3a / fga, 4) if fga else 0,
            "winPct": ranking.get("win_pct"),
            "wins": ranking.get("wins"),
            "losses": ranking.get("losses"),
            "gamesPlayed": int(games),
        }
        records.append(record)
    records.sort(key=lambda r: (r["season"], r["team"]))
    return records


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    game_seasons = load_game_seasons()
    team_games = aggregate_team_games(game_seasons)
    season_sums, team_season_sums = aggregate_seasons(team_games)
    team_meta = load_team_metadata()
    rankings = load_rankings()

    league_trends = build_league_trends(season_sums)
    scoring_mix = build_scoring_mix(season_sums)
    team_scatter = build_team_scatter(team_season_sums, team_meta, rankings)

    (OUTPUT_DIR / "league_trends.json").write_text(json.dumps(league_trends, indent=2))
    (OUTPUT_DIR / "scoring_mix.json").write_text(json.dumps(scoring_mix, indent=2))
    (OUTPUT_DIR / "team_scatter.json").write_text(json.dumps(team_scatter, indent=2))

    print("Wrote aggregated datasets to", OUTPUT_DIR)


if __name__ == "__main__":
    main()
