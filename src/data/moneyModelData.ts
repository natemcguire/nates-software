export const MONEY_MODEL_MARKDOWN = `# Shareware, Restored

## How money moves when you fork and sell

Most marketplaces make you guess. A cut here, a fee there, a "platform tax" nobody can point to on a diagram. This one doesn't work that way. You set one number, we freeze it the moment someone forks you, and the math never surprises anyone again.

## Two modes, not twelve

When you publish an app, you pick one of two modes. That's the whole decision.

**Personal.** Anyone can fork it for themselves. They can't resell their fork. Simple.

**Resale, at r%.** Anyone can fork it *and* sell their own version. If they do, they owe you \`r%\` of every sale, forever, automatically. You choose \`r\` — anywhere from 0% to 100%. Setting it to 0% just means "fork me, sell it, keep it all." That's not a third mode. It's Resale with the royalty dialed to nothing.

Every app is one or the other. No hybrid tiers, no "contact sales."

## The rate freezes the day someone forks you

Here's the part that makes the whole system trustworthy: the moment somebody forks your app, your rate gets locked onto that fork, permanently. You cannot raise it on them later. You cannot lower it either. It's frozen, full stop.

And it's not just your own rate that gets frozen — whatever *you* owe your upstream makers rides along with the fork too. If Bob forked Ann at 10%, and Carol forks Bob, Carol inherits Bob's 10% lien *and* Ann's 10% lien. Carol can't wipe out Ann's cut by publishing her own fork at 0%. She can only waive her own future royalty, on her own downstream forks. Nobody can zero out the people above them in the chain. That's the whole point of freezing it at the fork edge instead of trusting each generation to pass the money along honestly.

## Before you fork, you see the bill

This is the number that actually matters to you as a forker: before you clone anything, we show you **Σr** — the sum of every royalty you'd inherit from everyone upstream of that app. Think of it as cost of goods sold. If Σr is 20%, every dollar you make selling your fork has 20 cents already spoken for before you even get to the platform's cut. If Σr is high, maybe you look for a different app to build on. If it's low, that's a selling point for forking this one. The market prices the chain; we just show you the number honestly.

## How a sale actually settles

Say your fork sells for gross amount \`G\`.

1. The platform takes **10% flat, off the top.** No tiers, no volume discounts, no negotiating. \`platform_base = floor(0.10 × G)\`.
2. What's left — call it \`R\` — pays out the inherited royalties, oldest ancestor first. Each upstream maker gets \`floor(r_i × R)\`, where \`r_i\` is *their* frozen rate. This is additive: everyone's cut comes out of the same \`R\`, not nested off each other's remainder. A root maker's rate means the same thing whether they're one hop up or five.
3. You, the seller, keep whatever's left after the platform and every upstream lien are paid.

Nobody nests their cut inside somebody else's cut. Everyone's percentage means exactly what it says.

## Rounding dust goes to the house

Cents don't always divide evenly. When they don't, every maker allocation — the platform's base fee, every ancestor's lien, your own take — gets rounded *down*, never up. Whatever fractional cents get dropped by all that rounding get swept into the platform's total. Not yours, not your ancestors'. The house absorbs the dust, every time, in both directions — on a sale and on a refund. You are never shorted by rounding, and you are never overpaid by it either. The one thing rounding can never do is quietly hand out free money to a maker.

## All sales are final

We don't do buyer-initiated refunds. We don't do maker-initiated refunds. Once a sale clears, it clears. All sales final, no exceptions carved out for either side of the transaction. That's a real policy, not fine print you're supposed to miss.

There's exactly one exception to who can *initiate* one at all: Nate, who owns this platform, can issue a refund at his own discretion if something genuinely warrants it. That's a human safety valve for edge cases, not a button anyone else can press. It's buyer beware by default — but it only works if buyers aren't buying vaporware, which brings us to the next part.

## Nothing goes up for sale until it's proven to run

An app can't go on the market for paid resale until it's actually been built and booted, for real, with evidence — not "should work," not "works on my machine." Free and Personal listings can go up whenever you want. Anything with a price tag on it has to clear that bar first. All-sales-final is only fair if what you bought wasn't fiction.

## A worked example

Ann builds an app and sets her rate at 10%. Bob forks Ann and sets his own rate at 10%. Carol forks Bob. Carol sells her fork for $100.

Carol's chain now carries two frozen liens: 10% to Ann, 10% to Bob. Here's how a $100 sale splits:

- Platform takes its flat 10% off the top: **$10**.
- That leaves $90 to divide. Ann's frozen 10% lien comes out of that $90: **$9**.
- Bob's frozen 10% lien, same $90 base: **$9**.
- Carol keeps what's left: **$72**.

$10 + $9 + $9 + $72 = $100. Every cent accounted for, nothing nested, nothing hidden. Ann gets paid on every one of Carol's sales for as long as Carol sells that app, and neither Bob nor Carol can ever take that away from her.
`;
