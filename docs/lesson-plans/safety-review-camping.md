# Safety review 1: Outdoor Activity / Camping Chair (2026-09-30)

**Verdict: FIX.** 2 High and 4 Med findings need fixing before the plans go into the app. The reviewer read the files and edited none of them.

## Findings
1. **High. Summertime Fun outings are missing health forms, permission slips and the outing process.** This is Meeting 2 prep for every rank: Tiger, Wolf, Bear, Webelos and AoL. The header safety list leaves them out too.
   - Fix: add "Collect health forms (A/B) and permission slips, follow the council outing process, coordinate with the Cubmaster; another adult knows any EpiPen."
   - Source: scouting.org/health-and-safety/ahmr/
2. **High. Champions for Nature allows more tool use than the rules do.** The 2026 SAFE Project Tool Use chart (680-028) says:
   - Lions and Tigers use no tools on service projects.
   - Rakes, shovels and trowels start at Wolf/Bear.
   - Wheelbarrows, handsaws, electric screwdrivers and palm sanders are for Scouts BSA only.

   Fix:
   - Correct the header.
   - Lions fill pots by gloved hand, and adults use the trowels.
   - Bears use shovels only, and adults push the wheelbarrows.
   - Point the Wolf Council Fire, Bear Paws for Action and AoL Citizenship service outings to the chart.
3. **Med. Female adult rule missing.** If any girl attends, one of the two registered adults must be a woman 21 or over. This applies to every activity, meetings included (gss01). Fix: add this to every file's two-deep line, and make the AoL line firm.
4. **Med. Knife use goes beyond Keith's "at home only" rule, and the files contradict each other.**
   - Bear with Whittling at a campout: lets-camp.
   - Bear and AoL cutting line at fishing outings: fishing.
   - AoL carrying a knife on rides: cycling.
   - AoL cutting fruit at a den meeting: champions, which contradicts race-time's "no knives at den meetings".

   The Scouting America rules allow these once the knife adventure is earned, so this is a pack-policy choice, not a safety violation. Keith needs to state one knife rule.
5. **Med. No tenting plan for a Webelos or AoL scout at a den campout without a parent.** Fix: "tents alone or with a same-gender scout within two years of age, never with an adult" (gss01; the app's CAMP_SAFETY already says this).
6. **Med. The app's CAMP_AGES text says "An adult lights and tends the fire."** That contradicts Keith's Webelos Option B (the scout lights it with an adult at their elbow). Spec for app-engineer: new wording, delivered through refreshCampingSeed (bump CAMP_SEED_REV and record the old text's hash in CAMP_OLD_SEED).
7. **Low.** lets-camp Webelos fire step still says Option B needs "Keith's approval". Delete that.
8. **Low.** lets-camp says firewood may be "brought from home". Georgia State Parks say to buy it at or near the park.
9. **Low.** cycling misreads the hand-tool rule: the AAG 08/24 allows hand tools from Tiger up, not Wolf/Bear. Keeping tools from Tigers can stay a pack choice.
10. **Low.** summertime-fun calls Cub Summer Splash "a good den overnight". Keith's swim rule makes Splash a family option, so reword it to "families may choose Splash".
11. **Low.** AoL First Aid:
    - The fake tick is a sesame seed, and sesame is an allergen. Use a sticker.
    - The guest demonstrates choking thrusts on a volunteer. Show hand positions only, or use a manikin.
12. **Low.** bear.md has scouts photographing with a phone. Instead, an adult takes the photo or the scout sketches.
13. **Low.** The summer Webelos hike of 2–3 miles in 55 minutes in July is too fast. Cap it at 2 miles or lengthen the time.
14. **Low.** The cooking rule doesn't cover Webelos or AoL den or patrol campout meals. Keith should add "or a Webelos/AoL den campout".

## Cross-file consistency
- **Firem'n Chit:** lets-camp says no Cub Scout can hold one (official Chit page). The AoL, champions and fishing files and open question 5 say an AoL scout must earn it before using matches (Scout Basic Essentials page). The two official sources clash, and the result is that a Webelos may strike a match but an AoL scout may not. Use one line everywhere.
- **Handsaw:** the race-time header allows a handsaw at home from Tiger to AoL. The Bear, Webelos and AoL "Adult jobs" lists say all cutting is for adults, and the Bear job-sort step says the opposite.
- **Leftover food:** wolf, bear and lion say "don't send opened food home". The champions AoL fruit is sent home.
- **AoL troop overnight:** line 42 says each scout comes with a parent. Line 293 correctly says a patrol with two-deep leadership.
- **Casting spacing:** 6 ft at den casting nights, 10 ft at outings. Say that 6 ft is for washer practice only.

## Looks good
- Range sports: no den meetings and correct rank rules.
- Swimming: dry land only, with the eight points of Safe Swim Defense correct.
- Fire and stoves: fire and cooking are Webelos and up, and adults run stoves.
- Fishing: barbless hooks, no loose hooks at dens, still water, catch-and-release.
- Camping and Youth Protection: GSS camping rules, the Protect Yourself material at home, restroom buddies, and adult partners not counted toward the two leaders.

Sources: gss01, gss02, gss03, AAG 680-685 (08/24), SAFE Project Tool Use 680-028 (2026), AHMR page, Firem'n Chit page, Scout Basic Essentials, Georgia State Parks rules, dontmovefirewood.org.
