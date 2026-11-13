# Lunar Gateway Application Ecosystem

An interactive exploration of NASA's Lunar Gateway program — a 3D orbital simulation paired with five web apps that walk through the program's acquisition artifacts (work breakdown structure, cost estimate, schedule, risk register, and contract documents). A program overview dashboard and a cost and schedule confidence simulator sit on top of them.

Built to demonstrate what one analyst working with AI coding tools can produce from a single public NASA technical document.

**Live site:** https://greg-oyan.github.io/lunar-gateway/

---

## What this is

I'm not a software engineer. I'm an operations research analyst. Over a few months I took a 142-page public NASA technical document and used AI coding tools to build out a full acquisition package and turn it into a navigable web ecosystem — the kind of connected view that normally takes a team of people many months to produce.

This repository is the result. It's evidence for a simple claim: the wall between thinking and building is collapsing, and domain expertise plus AI tooling can now carry an idea from concept to working software without an engineering team.

## What's in here

| App | What it does |
|---|---|
| **3D Simulation** (`/`) | A Three.js orbital visualization of Gateway around the Moon, with a guided tour mode and a free-explore demo mode |
| **Program Overview** (`/overview/`) | Cost, schedule, and risk on one screen: headline figures, cost by element, a risk matrix, and annual spend above the phases and milestones on one time axis. An element scorecard folds open underneath. Any element drills down and carries its scope into the other apps |
| **WBS Explorer** (`/wbs/`) | Browse the Work Breakdown Structure — the hierarchical backbone that every other artifact hangs off |
| **Cost Explorer** (`/cost/`) | 100+ cost estimate line items tied back to WBS elements, with phasing and basis of estimate |
| **Schedule Explorer** (`/schedule/`) | 165 tasks and milestones from the master schedule |
| **Risk Register** (`/risk/`) | 22 program risks with likelihood/impact and cross-references to schedule milestones |
| **Documents Explorer** (`/documents/`) | 42 contract documents organized by type and phase |
| **Confidence Lab** (`/confidence/`) | A 10,000-trial Monte Carlo simulation of program cost and the first launch date, built from the estimate's low/base/high ranges and the risk register. Cost confidence curve, joint cost-and-date confidence, growth by source, and a fold-open table with a switch for every risk |

**Search everything:** press `Ctrl K` (`Cmd K` on a Mac) or `/` in any app, including the simulation, to search every WBS element, milestone, risk, document, and glossary term and jump straight to it.

The explorer apps share a cross-navigation layer — click a WBS ID inside the Cost Explorer and you'll land on the matching node in the WBS Explorer, with the context preserved. That's the point: individual artifacts are just puzzle pieces, but when they're wired together they become a navigable system.

## How every app is laid out

The five explorers follow one pattern, so learning one teaches the rest:

- **One title line**, then one workspace: a list or map on the left, the selected item on the right.
- **Controls sit on the thing they change.** Search and filters are inside the list they filter. The Risk Explorer's 5 by 5 matrix is itself the filter: click a cell.
- **List rows identify, the detail pane explains.** Nothing is stated twice on a screen.
- **One "Open in" row** under every selected item hands that item to the other apps with its context attached. Where you came from shows as a single pill with a Clear button.
- **Reference detail folds away** (technical framing, score math, evidence, sources) and opens in place.

## The simulation layer

`index.html` (the 3D simulation) is not edited. `suite-assets/simulation-layer.js` and `simulation-layer.css` sit on top of it and only press buttons the simulation already has:

- The launch screen has one primary action, Start Demo.
- The HUD leads with live telemetry. Fixed station facts open from "Station facts".
- Mouse and keyboard hints open from "Controls" instead of sitting on screen.
- A first-run prompt offers "Fly to Gateway", then points at the modules. It slows time to 1x first, because at the opening 600x the station outruns the camera. It goes away once a module is selected or it is dismissed.
- The module panel gains an Overview link and says "Open in" once.

Add `?layer=off` to the URL to see the simulation exactly as `index.html` draws it, or set `SIMULATION_LAYER_ENABLED` to `false` in `suite-assets/suite-context.js` to remove the layer. `scripts/verify-suite.mjs` fails if `index.html` drops an element the layer depends on.

## How it was built

- **AI tooling:** Claude Code (Opus 4.6) and Codex (GPT 5.3)
- **Hardware:** a personal laptop
- **Stack:** vanilla JavaScript, no framework. Three.js for the simulation. Hosted on GitHub Pages.
- **Data:** derived from publicly available NASA technical documentation and reformatted into the kind of artifacts a government acquisition team would produce

## Data disclaimer

The figures, schedules, and risks in this repository are **illustrative, not authoritative**. They were generated from public NASA source material to demonstrate what an acquisition package for a program like Gateway looks like in practice. Nothing here represents actual contract values, official government positions, or any specific organization's work.

NASA paused and restructured the Gateway program in early 2026. The data reflects the program as it was publicly described before that change.

## The Confidence Lab model

The Confidence Lab is an illustrative model on illustrative data. It is not a NASA estimate or a formal joint confidence level. What it reads from the repo data and what it assumes are kept separate:

- **Read from the data:** element cost ranges (low, base, high), risk likelihood and impact scores, WBS links, the first launch milestone, and annual spend.
- **Assumed:** how a 1 to 5 likelihood score maps to a probability, how a 1 to 5 impact score maps to dollars and months of slip, how concurrent slips overlap, what a month of delay costs, and how correlated the elements are.

Every assumption is a named constant at the top of `confidence/model.js`, is listed on screen under "Model assumptions", and the three that matter most have sliders. The seed is fixed, so a scenario always returns the same numbers, and the scenario is stored in the URL so it can be shared.

## Checks

```bash
node scripts/verify-suite.mjs
```

Covers register parity, score invariants, crosswalk integrity, nav parity across every app, reconciliation of the Overview's cost figures against the source CSVs, sanity checks on the Confidence Lab model (reproducible, growth sources sum to the total, matches the closed-form mean with risks off), and that every element the simulation layer hooks into still exists in `index.html`.

## Running locally

The apps are static HTML/JS — you can serve the repo root with any static server.

```bash
# Python
python3 -m http.server 8080

# Or Node
npx serve .
```

Then open http://localhost:8080 for the simulation, or http://localhost:8080/overview/ (or `/wbs/`, `/cost/`, `/schedule/`, `/risk/`, `/documents/`, `/confidence/`) for any of the apps.

## Known limitations

- **Mobile:** every app reflows to a single column at phone widths. The Schedule Explorer's timeline scrolls sideways there, and the 3D simulation is best on a larger screen.
- **Browser support:** tested in recent Chrome and Safari. The 3D simulation is WebGL-heavy — older hardware may struggle.

## License

MIT. See [LICENSE](LICENSE).

## Contact

Greg Oyan — [gregory.oyan@gmail.com](mailto:gregory.oyan@gmail.com) · [LinkedIn](https://www.linkedin.com/in/gregoryoyan) · [Substack](https://substack.com/@gregoyan)
