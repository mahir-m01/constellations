# Constellations: does the mind's compression code need words?

A cognitive task, an analysis pipeline and a report.
Each participant session takes about 20 minutes and works on a laptop with a mouse (preferred) or a phone.

| Path | What it is |
|---|---|
| `task/` | The task: a static web app (`index.html` + `task.js`), no build step |
| `task/apps-script.gs` | The Google Sheets receiver (optional) |
| `analysis/analyze.py` | Stats, figures, Excel workbook and LaTeX macros |
| `analysis/simulate.py` | Fake data for testing the pipeline only; it is watermarked SIMULATED |
| `analysis/lot_complexity.py` | LoT complexity calculator (Amalric 2017 grammar); its self-check reproduces all published values |
| `report/main.tex` | The report (`tectonic -X compile report/main.tex`) |

## 1. Deploy
```bash
cd task && vercel --prod     # check `vercel whoami` first: the CLI is currently logged in as computerport-tech
```
The microphone only works over HTTPS, and Vercel provides that.
You can also run it locally with `python3 -m http.server -d task 8765` and open `http://localhost:8765`.

URL options:
- `?demo` runs 1 practice + 2 test paths per block (about 4 min), for dry runs and class demos. Demo data is excluded from analysis.
- `?order=0` … `?order=5` sets the block order. Give consecutive participants 0, 1, 2, 3, 4, 5, 0, … so the orders stay balanced.
- `?pid=P01` assigns a participant ID.

## 2. Collect data into Google Sheets (optional; every participant can also download a CSV at the end)
1. Create a Google Sheet, then go to **Extensions › Apps Script** and paste in `task/apps-script.gs`.
2. **Deploy › New deployment › Web app**. Set Execute as: *Me* and Who has access: *Anyone*. Copy the `/exec` URL.
3. Paste that URL into `SHEET_URL` at the top of `task/task.js` and redeploy.
4. Test it: open the URL with `?demo`, finish the run, and check that rows appear in the tabs `participants` and `trials`.

## 3. Dry run (required by the assignment)
Do one `?demo` run and one full run yourself. Check that the microphone meter turns green when you say "the" and that
tapping registers. Note any problems for the report.

## 4. Running participants: protocol
- Use a quiet room: participants must speak aloud in the "say the" block. Use a laptop with a mouse, and close other tabs.
- Read nothing to them beyond the on-screen instructions. Say only: "Please follow the instructions exactly. In one block you'll speak aloud; that's expected."
- Rotate `?order=` across participants.
- Aim for **N ≥ 24** (a multiple of 6 keeps the block orders balanced). Including a few participants older than students makes the age analysis meaningful.

## 5. Analyse
```bash
# put every CSV in data/raw/: the Google Sheet "trials" tab (File › Download › CSV) and/or the participants' downloaded CSVs
.venv/bin/python analysis/analyze.py data/raw
tectonic -X compile report/main.tex
```
Outputs:
- `data/constellations_dataset.xlsx`, the Excel deliverable
- figures in `analysis/out/figs/`
- tables and macros in `analysis/out/`

Then rebuild `report/main.pdf`. As long as any simulated data is in the input, the report prints SIMULATED DATA on every page.
