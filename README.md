# workout-planner

Weekly training planner for cyclists. Reads current form (CTL/ATL/TSB) from
Intervals.icu and training recommendations from Xert, schedules a 7-day plan of
cycling, low-cadence strength intervals, weight training, and recovery, then
pushes the plan as events to the Intervals.icu calendar.

## Install

```sh
npm ci
cp .env.example .env   # then fill in credentials
```

Requires Node.js 20+.

## Configure

Credentials live in `.env`:

| Variable            | What it is                                |
| ------------------- | ----------------------------------------- |
| `INTERVALS_API_KEY` | Intervals.icu API key (Settings → API)    |
| `XERT_USERNAME`     | Xert account email                        |
| `XERT_PASSWORD`     | Xert account password (OAuth password grant) |

Workout definitions and scheduling rules live in `config.yaml`:

- `weight_training` — name, duration, and description pushed on weight days.
- `low_cadence` — name, duration, and description pushed on low-cadence days.
- `scheduling.tsb_fresh` — TSB above this is considered "fresh" (default `5`).
- `scheduling.tsb_fatigued` — TSB below this is considered "fatigued" (default `-10`).
- `scheduling.weight_sessions` — weight sessions per week (default `2`).
- `scheduling.min_weight_gap_days` — minimum days between weight sessions (default `2`).

## Commands

```sh
npm run status             # show current CTL/ATL/TSB and Xert metrics
npm run plan -- --dry-run  # print the week's plan without pushing
npm run plan               # generate and push the plan to Intervals.icu
```

The `plan` command fetches existing Intervals.icu events for the next 7 days
and leaves those dates untouched; only empty days are filled.

## How the schedule is built

For each 7-day window, starting from today:

1. **Place one low-cadence session** mid-week when possible, avoiding
   back-to-back hard days.
2. **Place two weight sessions** with at least `min_weight_gap_days` between
   them, again avoiding back-to-back hard days.
3. **Place one rest day**, preferring the day after a hard cluster.
4. **Fill remaining days with cycling.** Intensity is driven by TSB: above
   `tsb_fresh` → hard, below `tsb_fatigued` → easy, otherwise moderate. Any
   ride that would create back-to-back hard days is downgraded to easy.

Weight and low-cadence days are always classified as "hard" for the
back-to-back constraint.

## Development

```sh
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write
```

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, and tests
on push and PR to `main`.
