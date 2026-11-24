## What a run does {#run}

1. Reads A and B. A wired A or B replaces its field.
2. Applies the **Operator**.
3. Leaves by **onTrue** or **onFalse**.

- Neither port is an error.
- **Result** carries the outcome as `1` for true and `0` for false, so it can feed another **Condition**.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
* Condition: A == 0
<- Read Attribute: players.count
-> [onTrue] Create Backup: Full server
-> [onFalse] Notify: Players online
```

### Comparisons

| Operator | True when |
| --- | --- |
| `==` | A equals B. |
| `!=` | A does not equal B. |
| `>` | A is greater than B. |
| `<` | A is less than B. |
| `contains` | The text of A contains the text of B, and case matters. |

- Two numbers are compared as numbers, so `9` is less than `10`.
- A number is a wired number, or text that reads as one, such as `10`.
- Anything else is compared as text, and case matters.

> [!NOTE]
> `==` and `!=` compare as booleans when either side is the text `true` or `false`.
> The other side must read as a boolean too: a boolean, a number, or the text `true` or `false`.
> A number is true unless it is 0.
> A wired true arrives as `1`, so it equals the text `true`.

### Gates

`AND`, `OR`, `XOR`, `NAND` and `NOR` do not compare.
They read A and B as true or false, then combine the two.

- A value is true when it is the boolean true or a number other than 0.
- The text `true` in any capitals is true, and so is text that reads as a number other than 0.
- Everything else is false, including empty text, text such as `yes`, and a value that was not set.
- Each operand has an **is true** box, shown only for a gate operator.
- Checked, which is the default, the operand is used as it is.
- Unchecked, the operand is flipped: true becomes false and false becomes true.

> [!NOTE]
> `AND` with the box under A unchecked is true when A is false and B is true.

| A | B | AND | OR | XOR | NAND | NOR |
| --- | --- | --- | --- | --- | --- | --- |
| False | False | False | False | False | True | True |
| False | True | False | True | True | True | False |
| True | False | False | True | True | True | False |
| True | True | True | True | False | False | False |
