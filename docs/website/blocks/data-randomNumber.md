## What a run does {#run}

1. A block that uses **Value** runs.
2. This block reads **Min** and **Max**. A wired **Min** or **Max** replaces its field.
3. It picks a number from **Min** up to **Max**.
4. It passes **Value** to that block.

- This block has no control ports.
- The number is picked once per run, so every block using it in that run gets the same number.
- The number can have decimals, and it does not exceed **Max**.
- If **Max** is below **Min**, the number is **Min**.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
Condition: A > 50
<- * Random Number: 1 to 100
-> [onTrue] Create Backup: Full server
```
