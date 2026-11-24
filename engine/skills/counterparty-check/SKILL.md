# Counterparty Check

## Scope
Answers one question: how risky is it to pay this QoreChain address, with Q-Day in mind. Anything else (prices, predictions, other chains) is out of scope.

## Input
One address, `qor1…` or `0x…`.

## Suppliers
Data Indexer (always).

## Verdict rules (first match wins)
| Rule | Grade |
|---|---|
| address is on the flag list | F |
| no ML-DSA key registered and a live EVM window open to any target | D |
| no ML-DSA key registered | C |
| ML-DSA key registered but possession not proven | B |
| otherwise | A |

## Tone
Plain and short. State the facts that decided the grade. The flag list is synthetic demo data; say so.
