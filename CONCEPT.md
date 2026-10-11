# SOUK - concept

A fork of [Bot Crossing](https://github.com/Station-Sciences/bot-crossing) (MIT) reskinned as a
Tunisian medina. Every coding-agent thread on this machine is an artisan; every repo is a
workshop in the souk. Built for Faruk (faruk_automates). Runs locally, never deployed.

## The four answers

1. **What lives here?** Artisans. Robed, red chechia hat, copper-toned, one per thread.
2. **Setting?** A sun-bleached medina quarter: whitewashed cubic houses, limestone paving,
   Sidi Bou Said blue doors and shutters, arches, a dome or two, palms and olive trees.
   Flat ground, no water. Night = warm copper lanterns, lit windows, deep indigo sky.
3. **A project's home?** A workshop stall: a whitewashed block with an arch, blue door, awning,
   pots and rugs outside. Grows (sinks up out of the ground) with the work done.
4. **What does working look like?** Hammering copper on an anvil, sparks flying.

## Mapping

| The world | The sessions |
| --- | --- |
| One workshop plot (hex cells) | One project / repo |
| One artisan | One thread |
| How built-up the workshop is | Transcript size, log scale |
| Artisan steps into the alley and waves under a lantern beam | Thread needs a reply |
| Walks in through the medina gate (Bab) | Thread appeared |
| Walks back out through the gate | Archived |

## States

| State | Artisan |
| --- | --- |
| Errored | Slumps, hat askew, red ember over head |
| Working | Hammering copper, sparks |
| Finished well | Cheers, confetti (rose petals / jasmine palette) |
| Waiting on you | Waves, tall warm lantern beam visible from anywhere |
| Untouched for days | Sits on the floor asleep, `z` |
| Anything else | Potters, drinks tea |

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| whitewash | `#f4f1ea` | walls |
| limestone | `#d9c7a3` / `#eee4d0` | ground, paving |
| bou-said blue | `#1f5fa8` | doors, shutters, plot borders, accent |
| copper | `#b87333` | lanterns, hammers, trim, night glow |
| chechia red | `#a8322d` | hats, rugs |
| olive | `#6b7a3a` | foliage |
| sky top | `#3f7fc9` | day sky |
| horizon | `#f2dcb8` | warm haze |
| night | `#141a3a` | indigo sky |

## Rules

- Engine untouched where possible: server/, harness adapters, layout, instancing, camera, settings.
- Every hand-written shader calls `withCurve` (see DECISIONS.md).
- Free / CC0 assets only. Credit Bot Crossing (Jarren Rocks), KayKit, Kenney.
- No em dashes in copy or comments. No call to prayer audio.
