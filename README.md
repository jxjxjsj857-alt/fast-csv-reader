# fast-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/jxjxjsj857-alt/fast-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/jxjxjsj857-alt/fast-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0: it reads broken CSV files exactly as the reference does, but with native scans instead of one character at a time. `solve.js` is a dependency-free ES module whose `run(input)` returns `{columns, rows, errors}` for every `{text, header}` — same broken-row policy as csv-reader 1.0.0 (BOM dropped, LF/CRLF record ends, stray CRs, quoted fields with `""` escapes and CR/LF normalised to LF, `quote_junk` and `unterminated_quote`, short/long rows padded or cut to the first record's width). Most records hold no quote and no stray CR, so they are split with one native `split(',')`; records that hold a quote or a stray CR are parsed field by field with `indexOf` and a single regex scan per field.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`), answers each with `run` from `solve.js`, and writes `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR`). Requires Node 22.18 or later.

---

<sub>Entered on [make.fun](https://make.fun/?ref=r3kzxg9p&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
