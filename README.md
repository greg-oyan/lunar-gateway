# Lunar Gateway Application Ecosystem

An interactive exploration of NASA's Lunar Gateway program — a 3D orbital simulation paired with five web apps that walk through the program's acquisition artifacts (work breakdown structure, cost estimate, schedule, risk register, and contract documents).

Built as a demo for the AICamp San Diego talk **"Building A Story With AI"** (April 29, 2026).

**Live site:** https://greg-oyan.github.io/lunar-gateway/

---

## What this is

I'm not a software engineer. I'm an operations research analyst. Over a few months I took a 142-page public NASA technical document and used AI coding tools to build out a full acquisition package and turn it into a navigable web ecosystem — the kind of connected view that normally takes a team of people many months to produce.

This repository is the result. It's evidence for a simple claim: the wall between thinking and building is collapsing, and domain expertise plus AI tooling can now carry an idea from concept to working software without an engineering team.

## What's in here

| App | What it does |
|---|---|
| **3D Simulation** (`/`) | A Three.js orbital visualization of Gateway around the Moon, with a guided tour mode and a free-explore demo mode |
| **WBS Explorer** (`/wbs/`) | Browse the Work Breakdown Structure — the hierarchical backbone that every other artifact hangs off |
| **Cost Explorer** (`/cost/`) | 100+ cost estimate line items tied back to WBS elements, with phasing and basis of estimate |
| **Schedule Explorer** (`/schedule/`) | 165 tasks and milestones from the master schedule |
| **Risk Register** (`/risk/`) | 22 program risks with likelihood/impact and cross-references to schedule milestones |
| **Documents Explorer** (`/documents/`) | 42 contract documents organized by type and phase |

The five explorer apps share a cross-navigation layer — click a WBS ID inside the Cost Explorer and you'll land on the matching node in the WBS Explorer, with the context preserved. That's the point: individual artifacts are just puzzle pieces, but when they're wired together they become a navigable system.

## How it was built

- **AI tooling:** Claude Code (Opus 4.6) and Codex (GPT 5.3)
- **Hardware:** a personal laptop
- **Stack:** vanilla JavaScript, no framework. Three.js for the simulation. Hosted on GitHub Pages.
- **Data:** derived from publicly available NASA technical documentation and reformatted into the kind of artifacts a government acquisition team would produce

## Data disclaimer

The figures, schedules, and risks in this repository are **illustrative, not authoritative**. They were generated from public NASA source material to demonstrate what an acquisition package for a program like Gateway looks like in practice. Nothing here represents actual contract values, official government positions, or any specific organization's work.

NASA paused and restructured the Gateway program in early 2026. The data reflects the program as it was publicly described before that change.

## Running locally

The apps are static HTML/JS — you can serve the repo root with any static server.

```bash
# Python
python3 -m http.server 8080

# Or Node
npx serve .
```

Then open http://localhost:8080 for the simulation, or http://localhost:8080/wbs/ (or `/cost/`, `/schedule/`, `/risk/`, `/documents/`) for any of the explorer apps.

## Known limitations

- **Mobile:** the apps are optimized for desktop and large screens. Mobile layout is on the backlog.
- **Browser support:** tested in recent Chrome and Safari. The 3D simulation is WebGL-heavy — older hardware may struggle.

## License

MIT. See [LICENSE](LICENSE).

## Contact

Greg Oyan — [gregory.oyan@gmail.com](mailto:gregory.oyan@gmail.com) · [LinkedIn](https://www.linkedin.com/in/gregoryoyan) · [Substack](https://substack.com/@gregoyan)
