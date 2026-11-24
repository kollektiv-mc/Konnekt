## What a run does {#run}

1. A block that uses **Result** runs.
2. This block reads A and B. A wired A or B replaces its field.
3. It applies the **Operator** once per run.
4. It passes **Result** to that block.

- This block has no control ports.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
Condition: A > 20
<- * Math: A + B
-> [onTrue] Notify: Over 20
```

| Operator | Result |
| --- | --- |
| `+` add | A plus B. |
| `-` subtract | A minus B. |
| `×` multiply | A times B. |
| `÷` divide | A divided by B. |
| `%` mod | The remainder of A divided by B, after both have their decimals cut off. |
| `Δ` difference | The gap between A and B, which is not negative. |

> [!WARNING]
> Dividing, or taking the remainder, with B at `0` sets no output, and no error is shown.
> The block that would use the result uses its own field instead.
