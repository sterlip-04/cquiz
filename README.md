# cquiz

**A classroom exam built around conversation.**

cquiz helps an instructor assess a whole class through simultaneous conversations at small tables. Students explain what they know, listen to others, add useful insights, and move between groups. Their phones coordinate the activity and capture their spoken contributions as text. The instructor receives individual rankings, component scores, and the evidence behind them.

The vision is to make the depth of an oral exam practical for a classroom of students, with enough structure to compare individual contributions and enough flexibility for a real conversation to develop.

## Why we're building it

A conversation can reveal whether someone understands an idea well enough to explain it, apply it, and build on another person's thinking. An instructor can probe that understanding in an oral exam, but conducting those exams one student at a time takes substantial time.

cquiz distributes the conversation across the room. The software manages turns, records contributions, supports assessment, and changes the groups as evidence accumulates. The instructor supervises the class and reviews the results.

The first use case is a university course in AI Tools and Techniques. The broader idea applies to subjects where students should be able to offer useful advice, explain a decision, or connect concepts in conversation. Extending to other subjects will require suitable question banks and classroom validation.

## What an exam feels like

Imagine a table of four students responding to a question such as, “What advice would you give someone using this tool for the first time?” One student contributes an insight. Another adds a different point or a meaningful extension. Each response creates individual evidence of understanding, while tablemates privately assess the competence it demonstrates.

The default format is three 15-minute rounds with two five-minute transitions: 55 minutes altogether. The design supports up to 100 participants, normally in groups of four, with groups of three to five when needed.

1. **Prepare.** The instructor imports a roster and a question bank containing prompts, weighted insights, and grading guidance. The app supplies templates and a preparation prompt; instructors prepare the content externally.
2. **Join.** Students enter on their own phones, complete a speech check, and receive a table assignment. The instructor verifies attendance.
3. **Contribute.** Students volunteer for speaking turns. A selected speaker gives an answer, sees the collected transcript, and submits it. Tablemates complete private competence ratings.
4. **Regroup.** Between rounds, students receive new table assignments informed by the evidence collected so far. The grouping logic considers current mastery, limited evidence, and repeat tablemates.
5. **Review.** The instructor inspects rankings, points, component scores, transcripts, ratings, and grading explanations, then exports the results and supporting evidence.

Students see the next action they need to take. Standings and assessment details stay in the instructor workspace.

## The assessment idea

The current experimental model combines three signals. The instructor can change their weights before an exam; the settings are then frozen for that exam.

| Signal | What it represents | Default weight |
| --- | --- | ---: |
| AI mastery | Rubric-based assessment of correctness, depth, and topic breadth in a student's contributions | 50% |
| Peer competence | Tablemates' private judgments of demonstrated competence | 30% |
| Willingness | Volunteering across eligible opportunities to contribute | 20% |

AI evaluates contributions against the instructor's uploaded insights. New insights and meaningful extensions can earn credit; repeating an already credited insight at the same table for the same question earns no additional insight points. Those points are preserved alongside the composite ranking.

Peer ratings are also preserved. Their influence is recalculated as evidence of the raters' own mastery and peer standing develops. This is a design hypothesis about how to combine judgments, and the calculation must remain inspectable.

Willingness measures volunteering when a student is eligible. It is a separate assessment choice whose relationship to knowledge needs investigation. Rapid tapping gives no advantage.

The app also collects private appearance and verbal-fluency diagnostics so their relationships with perceived competence can be studied. These diagnostics do not affect grades, rankings, or grouping.

The full protocol, including formulas and limitations, is in [the scoring specification](docs/scoring.md).

## Principles for contributors

- **Keep the conversation central.** Phone interactions should be brief and clear so students can attend to the people at their table.
- **Preserve the evidence.** Accepted answers, original ratings, insight points, and calculation history must support inspection and recalculation.
- **Make uncertainty visible.** Limited participation, missing ratings, failed grading, and unstable calculations should be apparent to the instructor. Current standings are provisional estimates.
- **Recover from interruptions.** A disconnect, reload, or provider failure should preserve accepted work and give the instructor a clear recovery path. Live grading failures must remain visible.
- **Protect student information.** Keep credentials and real exam data out of source control. The grading request omits roster names, emails, and student IDs. Student screens must not expose classmates' assessment records.

## Where the project stands and where help matters

This repository contains an implemented prototype covering imports, instructor and student sessions, speech transcription, AI evaluation, peer ratings, adaptive grouping, rankings, exports, and recovery. It includes a synthetic rehearsal mode for exploring the complete flow.

The assessment model is experimental. Classroom evidence is needed to evaluate its fairness, reliability, and usefulness. Rankings are assessment estimates; cquiz does not submit official institutional grades. The [verification record](docs/verification.md) documents dated checks and their limits. Before a graded classroom exam, verify live AI grading, hosted persistence, and speech recognition on actual student phones over HTTPS.

For developers joining the project, the most valuable work is to:

- Make the speaking, listening, rating, and movement flow dependable in a busy classroom.
- Help instructors understand why a student received a score and where the evidence is thin.
- Investigate how grouping and peer weighting affect opportunities and results.
- Strengthen recovery when devices, networks, transcription, or the AI provider fail.
- Use classroom observations to refine the product and assessment assumptions.

A successful first classroom use means students can complete the conversations, the instructor can recover from interruptions, and the results come with an intelligible record of what each student contributed.

## Run locally

Requires Node.js 24 and npm. Run `npm ci`, `npm run setup`, `npm run build`, then `npm start`. Open http://localhost:4318/admin. The generated instructor password is in the private `.env` file. Local SQLite data lives in `data/`; keep that folder and its `server.key` together when backing up. A laptop's localhost address is accessible only on that laptop; phone speech requires a hosted HTTPS address.

Use **Load rehearsal kit** in the instructor workspace to try the complete exam with fictional students. Rehearsal grading is explicitly synthetic. Live exams require a successfully tested OpenRouter configuration and imported course content.

## Host on Vercel

This repository includes Vercel configuration for the React frontend and same-origin API. Hosted exams require PostgreSQL; SQLite is used only for a local persistent server. See [hosting setup](docs/hosting.md). No secrets, exam data, real student roster, or screenshots are included in Git.

## Find your way around

The frontend uses React, TypeScript, and Vite. An Express/Node backend owns exam state, timing, and assessment. SQLite supports a persistent local server; PostgreSQL supports hosted Vercel use. Browser speech recognition supplies transcripts, and OpenRouter connects the selected grading model.

| Start here | Purpose |
| --- | --- |
| [`src/App.tsx`](src/App.tsx) and [`src/speech.ts`](src/speech.ts) | Instructor and student screens; browser transcription |
| [`server/engine.mjs`](server/engine.mjs) | Exam lifecycle and contribution flow |
| [`server/scoring.mjs`](server/scoring.mjs) and [`server/grouping.mjs`](server/grouping.mjs) | Assessment calculations and table assignments |
| [`server/provider.mjs`](server/provider.mjs) | AI evaluation and response validation |
| [Product vision](docs/product-vision.md) and [requirements](docs/prd.md) | Product intent and implementation contract |
| [Exam runbook](docs/exam-runbook.md) and [import format](docs/import-format.md) | Operating an exam and preparing its inputs |
| [Design guidance](docs/design.md) | Interface conventions |

Start with the rehearsal kit, follow one contribution through the system, and inspect its exported evidence. Use fictional students and synthetic fixtures when developing or sharing examples.

## Checks

`npm run build` compiles the production frontend. `npm test` exercises scoring, grouping, imports, protected sessions, persistence, provider failures and hosted PostgreSQL behavior. `npm run test:browser` rehearses a complete four-phone exam using simulated browser speech. Real phones, live OpenRouter grading, and the hosted database must still pass an operator rehearsal before a graded class exam.

Browser speech support varies. cquiz stores text only; the browser's speech provider may process audio. The app does not capture, upload or retain audio files. Email plus student ID is a roster identity claim, so the instructor must verify physical attendance. Rankings are experimental assessment estimates, not a validated psychometric model or official grade submission.
