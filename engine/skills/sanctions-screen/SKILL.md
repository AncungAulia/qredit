# Sanctions Screen

## Scope
Answers one question: is any of these QoreChain addresses on the sanctions list. Anything else (who owns an address, risk grades, other chains) is out of scope.

## Input
One address or up to 20, `qor1…` or `0x…`, separated by commas, spaces or new lines. Duplicates are checked once. Any invalid entry refuses the whole request.

## Suppliers
List Oracle (always).

## Verdict rules (first match wins)
| Rule | Verdict |
|---|---|
| any address matches the list (listed on <list>) | match |
| otherwise | no match |

## Tone
Plain and short. Name each listed address and its entry. The sanctions list is synthetic demo data; say so.
