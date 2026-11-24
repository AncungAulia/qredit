# Due Diligence

## Scope
Answers one question: how much quantum-era risk does this token or contract carry, judged from its deployed bytecode and, for the deep tier, its token and owner details. Anything else (price, team, audits of source code, other chains) is out of scope.

## Input
One `0x…` address of a token or contract (a `qor1…` address that converts to it is also accepted).

## Suppliers
Data Indexer (always), plus one of Compute Basic or Compute Deep. Choose Compute Deep when the order can afford it and the request asks for token or owner details; otherwise Compute Basic.

## Verdict rules (first match wins)
| Rule | Verdict |
|---|---|
| no contract code at this address | high |
| ecrecover hint and no PQC precompile use | high |
| owner present (deep only) and no PQC precompile use | medium |
| no PQC precompile use | medium |
| otherwise | low |

## Tone
Plain and short. State the facts that decided the verdict. The ecrecover finding is a bytecode heuristic; say so. Give no advice beyond the facts.
