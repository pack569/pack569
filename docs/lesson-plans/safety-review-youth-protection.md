# Safety review 2: Youth Protection and brand (2026-09-30)

**Verdict: FIX.** There are 4 High, 3 Med and 5 Low findings, and each one is a text fix of a line or two. The reviewer read all 14 files and edited none of them. The plans sit outside the git repo, so nothing here is published.

## Findings

1. **High · The disclosure steps (wolf.md, which five other files point to) are incomplete and in the wrong order.** They treat the Helpline as if it replaced a report to the authorities. **Fix:** replace them with:
   > Stay calm, listen, don't question or investigate.
   > 1. Make sure the child is safe, and call 911 for an injury or immediate danger.
   > 2. **You personally** report within 24 hours to Georgia DFCS, **1-855-GACHILD (1-855-422-4453)**, or to local law enforcement. You can't hand this to another leader.
   > 3. Then notify the NEGA Scout executive. If you can't reach them, call Scouts First, **1-844-SCOUTS1 (1-844-726-8871)**.

   Sources: scouting.org/training/safeguarding-youth/ ("Steps to Reporting Child Abuse"); gss01 ("All persons participating in Scouting programs are mandated reporters"); Georgia DFCS PAMMS 3.24 / O.C.G.A. 19-7-5 (youth-organization volunteers are mandated reporters, 24 hours). This also answers open question 1.
2. **High · Early arrivals open a one-on-one window.** The places:
   - bear.md:61 and webelos.md:63: the denner comes 5 minutes early.
   - wolf.md:101 and :121: the whole den comes 10 minutes early.
   - wolf.md:461: "Early scouts… play by the bench".
   - arrow-of-light.md:64: an early-arrival project.

   **Fix:** "Early set-up starts only when both registered adults are there; the scout's parent stays until then." (gss01)
3. **High · The chase vehicle on cycling rides could carry a lone scout** (cycling.md:34, :563, :637, :688, :786, :802). **Fix:** "The chase driver never carries a lone scout who isn't their own child. Call the parent, add a second adult, or carry a buddy too." Add the same line wherever a plan says "plan transport" (wolf.md:95, :148; aol:104). (YP FAQ, Transportation)
4. **High · "My Trusted Adults" in Wolf (wolf.md:445–448).** Every Wolf names a trusted adult aloud, and if a scout names no one, the leader "tells that family privately". If the harm is at home, telling the family could put the child at risk. This also contradicts Lion and Tiger, which never ask aloud. **Fix:** drop the step, or turn it into a private card the scout takes home. The tip becomes: "If a scout says they have no one, don't contact the family; follow the disclosure steps if anything worries you."
5. **Med · webelos.md:47: posted examples for the Oath's three points.** Each scout posts a duty-to-God example on the wall. **Fix:** use sticky notes for country, others and self only. The leader names duty to God, and families explain it at home.
6. **Med · Photos (wolf.md:157 group photo, arrow-of-light.md:618 crew photo).** There's no parent-permission check. **Fix:** one rule everywhere: "Photograph only scouts whose parents gave photo permission; post only on the pack's official channel, with no names."
7. **Med · An outdated Youth Protection link** (tiger.md:416, webelos.md:481, aol:507) now redirects to /training/safeguarding-youth/. Also, wolf.md:488 should cite "gss01, Scouting's Barriers to Abuse".
8. **Low · swimming.md:56.** "One-on-one" swim test wording. Fix: "one scout at a time, in view of other staff and swimmers".
9. **Low · arrow-of-light.md:522–524.** The emergency contact sheet needs a privacy line: "Leaders don't collect or photograph the sheets" (as in tiger.md:465).
10. **Low · wolf.md:101, :125–135.** Home models with the scout's name and street names. Fix: "made-up street names, no house numbers; first name only."
11. **Low · Sharing family details.** The holiday-card lines "tell how your family celebrates" (webelos:144, aol:184) and Lion "Who Lives at My House" (lion:119) should be optional ("if you want to…").
12. **Low · race-time.md.** Use "Pinewood Derby®" (and "Raingutter Regatta™") at the first mention. The exact first-reference rule is unconfirmed, so verify it.

## Cross-file consistency
- **Lion/Tiger restrooms:** the elective files say "always with your own grown-up". Use the rank-plan wording instead: "a parent takes their own; otherwise buddies go together and an adult waits outside." Affected: champions :166, :279; lets-camp :110, :143, :161, :284; summertime :144.
- **Photos:** four different rules in the files. Use the single rule from finding 6.
- **Trusted adults:** Wolf asks aloud, Lion and Tiger don't. See finding 4.
- **Disclosure steps:** they live only in wolf.md. Consider one shared "If a scout discloses" card in the app.
- **bear.md:146:** still says "confirm the organization and its deadline". That's already answered: 10,000 for the Troops.

## Looks good
- Protect Yourself material stays at home, the parent notice goes out first, and Shout, Run, Tell counts in the den only when the partner is the parent.
- Faith is always family-led. The church is one option, non-religious traditions count, and every share is opt-in.
- Scouts are handed off by name at every closing. There are no Lion or Tiger drop-offs, guests are never alone with scouts, and there's no den shooting or swimming.
- First names only. Scouts use no devices. Every "text me" line goes to parents.
- Copyright: 30 official pages were spot-checked, and no copied text was found. "Scouting America" and "Scouts BSA" are used correctly.
