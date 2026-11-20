# gta6-trophy-rarity-forecast-01-r4
[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/tronolllanj-creator/gta6-trophy-rarity-forecast-01-r4/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/tronolllanj-creator/gta6-trophy-rarity-forecast-01-r4/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
this program forecasts each GTA VI trophy's Exophase earn rate at 2026-11-26 as five quantiles, from the house's recorded reads.
## Model
- refresh-cohort model — each Exophase refresh brings a new player cohort, and per-trophy cohort earn rates are estimated from past refreshes (recency-weighted)
- players_tracked is extrapolated to the target with a log-log fit
- with no refresh in history it assumes one refresh like the documented launch-night one (players x6.06, earned 943 to 4276) and spreads the new earned growth broadly across trophies, concentrated on the already-most-earned ones as E^3.5 (calibrated on graded rounds 2/3, losses 0.147/0.143)
- spread comes from backtesting the model on past refreshes in the same case, with a 0.30 logit sigma when history is flat
## Run
    mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
<sub>Entered on [make.fun](https://make.fun/?ref=3bm3ytwk&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>