---
title: Cron expressions
kind: reference
lead: The **Cron Schedule** block fires when the clock matches a five-field expression.
shelf: scheduler
order: 3
summary: The five fields, with examples.
facts:
  Topics: Scheduler
related:
  - /docs/blocks/trigger-cron.html
  - /docs/scheduler-editor.html
  - /docs/blocks/
---

## Fields {#fields}

| Field | Values |
| --- | --- |
| Minute | `0` to `59` |
| Hour | `0` to `23` |
| Day of month | `1` to `31` |
| Month | `1` to `12` |
| Day of week | `0` to `6`, where `0` is Sunday |

- Write the five fields in that order, separated by spaces.
- The block checks the clock at the start of each minute.
- It uses the time zone of this computer.
- Day of month and day of week must both match.
- A block fires at most once a minute, and only while its graph is on.

## Syntax {#syntax}

| Form | Example | Means |
| --- | --- | --- |
| Any value | `*` | Every value of the field. |
| Value | `30` | Exactly that value. |
| Range | `9-17` | Every value from the first to the second, both included. |
| List | `0,15,45` | Any listed value. An item can be a value or a range. |
| Step | `*/10` | Every value divisible by the step. Day of month `*/10` is the 10th, 20th and 30th. |

## Examples {#examples}

| Expression | Runs |
| --- | --- |
| `* * * * *` | Every minute. |
| `*/5 * * * *` | Every 5 minutes, on the minutes 0, 5, 10 and so on. |
| `0 * * * *` | At the start of every hour. |
| `0,30 * * * *` | At the start and the middle of every hour. |
| `30 9 * * *` | Every day at 09:30. |
| `0 */6 * * *` | At 00:00, 06:00, 12:00 and 18:00. |
| `0 4 * * 1-5` | At 04:00 from Monday to Friday. |
| `0 0 * * 0` | At midnight on Sunday. |
| `0 12 1 * *` | At 12:00 on the 1st of each month. |
| `15 3 1 1 *` | At 03:15 on 1 January. |
| `0 9 13 * 5` | At 09:00 on a day that is both the 13th and a Friday. |

```timeline
00:00: `0 */6 * * *` fires
06:00: fires
12:00: fires
18:00: fires
```

## Limits {#limits}

> [!WARNING]
> An expression the parser cannot read never matches, and nothing reports it.

- An expression that does not have five fields never matches.
- Names such as `MON` or `JAN`, macros such as `@hourly`, and `7` for Sunday are not read.
- A step works only as `*/n`, so `1-5/2` and `5/15` never match.
- A range that wraps, such as `22-2`, never matches.
- The next run is looked up 14 days ahead.
  A rarer schedule shows no next run time.
