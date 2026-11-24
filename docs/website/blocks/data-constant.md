## What a run does {#run}

1. A block that uses **Value** runs.
2. This block reads **Value** as the chosen **Type**.
3. It passes the result to that block.

- This block has no control ports.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
Condition: A == B
<- * Constant: 0
```

| Type | Value output | Port type |
| --- | --- | --- |
| String | The text as it is. | string |
| Float | The text as a number, decimals allowed. | number |
| Integer | The text as a whole number, digits only. | number |
| Boolean | `1` for the text `true` or `1`, `0` for anything else. | bool |

> [!WARNING]
> A **Float** or **Integer** value that does not parse sets no output, and no error is shown.
> The block that would use the value uses its own field instead.

> [!NOTE]
> **Boolean** matches the text exactly, so `True` counts as false.
