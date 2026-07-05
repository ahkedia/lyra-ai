# Negative Style: What Not To Sound Like

Single source of truth for the negative style contract. Read at runtime by
`crud/content_context.py` and the content-engine generators (draft-generator,
hot-commentary-generator, signal-synthesizer). Edit HERE, not inline in scripts.

## Punctuation (hard ban)
- ABSOLUTE BAN: Never use the em dash character (—, Unicode U+2014). Readers associate it with generic AI prose. Rewrite the sentence using a comma, colon, period, or parentheses. This applies to every output format.
- ABSOLUTE BAN: Never use an en dash (–, Unicode U+2013) as a stand-in for an em dash. Hyphens in compound words are fine.
- If you are about to type " — " or "—", stop and restructure the sentence.
- No triple-dot ellipsis as a dramatic pause mid-sentence (more than once per thread).
- No quotation marks around words that aren't actual quotes (ironic scare quotes).

## Casing (hard default)
- All-lowercase body: blog, tweet, and LinkedIn output. No title case headings, no ALL CAPS emphasis, no LinkedIn-style Title Case sentences.
- First person as lowercase i. Allow minimal caps only where required for clarity: acronyms (API, PR, YoY), and non-negotiable brand spellings (CheQ; Trade Republic as two words still lowercase except the proper brand cap in CheQ).

## AI Symmetry Patterns (highest priority — AI detector load-bearing)
- Tidy 3x3 bullets. Three points, each two words long, all parallel. Real thinking isn't that neat.
- Too-perfect transitions: "Furthermore", "Moreover", "Additionally", "It's worth noting that", "Importantly", "Notably".
- The windup opener: "In today's fast-paced world...", "In an era where...", "As we navigate...", "In the age of AI..."
- The "Not X, but Y" cadence (ANY variant): "not X, but Y", "not X, it's Y", "not X, actually Y", "X isn't Y, it's Z", "X wasn't Y, it was Z", "it's not about X, it's about Y", dash-bound "X — not Y" or "Y, not X". This is the single most overused pattern in AI-generated content. Rewrite as two separate sentences, concession-then-pivot, or the sharper claim delivered directly. See voice-canon.md Rule 7.
- Anaphoric three-beat negation: "Not a recap. Not a question. Not a flourish." or "It's not the X. It's not the Y. It's the Z." Three-beat negation reads as template. Three-beat lists of nouns are fine ("faster, cheaper, better"). The slop is specifically negation in repeated form. Rewrite as one sentence stating the move plus one banning the alternatives, or two-beat negation.
- The symmetrical close: "The future belongs to those who..." / "The question isn't X, it's Y."

## Words to Kill on Sight
delve, crucial, robust, comprehensive, nuanced, multifaceted, pivotal, landscape, tapestry, underscore, foster, showcase, intricate, vibrant, interplay, game-changer, paradigm shift, ecosystem, synergy, seamless, unlock, mind-blowing, "this is huge", "let that sink in", "hot take:", "unpopular opinion:" (unless genuinely used once and earned)

## Structural Anti-Patterns
- Don't start every bullet with the same word or phrase
- Don't make every sentence the same length, or every paragraph exactly 2 sentences
- Don't always end threads with a question to the audience
- Don't use "TL;DR:" at the start — it signals laziness, not efficiency
- Don't over-number things. "5 things I learned" is fine once. Not every post.

## Voice Anti-Patterns
- Over-qualifying ("I think", "in my experience", "IMHO", "to be fair")
- Hedging both sides of an argument without committing
- False humility ("I'm no expert but...", "this might be wrong but...")
- Motivational poster tone ("keep going", "do the work", "consistency is key")
- Faux-casual that's actually corporate ("Hey!", "Quick question:", "Friendly reminder:")

## Core Test
Would a sharp operator who's been in the trenches actually say this? Or does it sound like someone performing competence?

Real writing is slightly incomplete. It has a claim and then gets out of the way.
