# ✦ Constellations

**A tiny browser game with a big question: does your memory need words?**

Stars light up one after another and you click them back in the same order. Some paths are simple patterns (a square, a
zigzag), others are random. Your brain squeezes the simple ones into a short "mental program", a bit like a zip file. We test
whether that inner code is made of words by having people softly repeat "the" in one round (which keeps the inner voice busy)
and tap a key in another (just as distracting, but the inner voice stays free).

**Play it:** https://constellations-task.vercel.app · **Quick demo (4 min):** https://constellations-task.vercel.app/?demo

A cognitive psychology class project. Sessions take about 20 minutes on a laptop (best) or a phone.

## What's in here

| Folder | What lives there |
|---|---|
| `task/` | The game itself: plain `index.html` + `task.js`, no build step, deploys anywhere static |
| `task/apps-script.gs` | Optional Google Sheets receiver, so results land in a spreadsheet automatically |
| `analysis/analyze.py` | Turns the raw CSVs into stats, figures, an Excel workbook and numbers for the report |
| `analysis/lot_complexity.py` | Scores how "compressible" each path is (Amalric et al., 2017). Its self-check reproduces every published value |
| `analysis/simulate.py` | Makes fake participants so you can test the pipeline. Everything it touches gets stamped SIMULATED |
| `report/main.tex` | The research report. Numbers and figures fill themselves in from the analysis |

## Running a session

Send each person one link, rotating through the six block orders so everything stays balanced:

| Person | Link |
|---|---|
| 1, 7, 13, 19 | https://constellations-task.vercel.app/?order=0 |
| 2, 8, 14, 20 | https://constellations-task.vercel.app/?order=1 |
| 3, 9, 15, 21 | https://constellations-task.vercel.app/?order=2 |
| 4, 10, 16, 22 | https://constellations-task.vercel.app/?order=3 |
| 5, 11, 17, 23 | https://constellations-task.vercel.app/?order=4 |
| 6, 12, 18, 24 | https://constellations-task.vercel.app/?order=5 |

Tips that make the data great:

- A quiet spot where speaking softly is fine works best. Libraries are tricky, empty classrooms and home are perfect.
- Open links in **Chrome or Safari**. Links opened inside WhatsApp or Instagram often can't use the mic.
- If the mic misbehaves, people can pick another mic, try again, or skip. Nobody gets stuck, and we can still use their data.
- Aim for 24 people (a multiple of 6). A few non-students make the age analysis much more interesting.
- At the end everyone sees a **Download my data** button. Collect those CSVs (or set up the Google Sheet below).

Other handy URL options:

- `?demo` is a 4 minute taste with no forms, and nothing gets saved. Great for showing people.
- `?test` is a short but complete run that does upload to the sheet, marked `test`, so the analysis ignores it. Perfect for teammates checking that everything records.
- `?pid=P01` sets a participant ID.
- `?rescue` lists every session saved on that device, a lifesaver if someone closes the tab halfway.

## Getting results into a Google Sheet (optional)

1. Create a Google Sheet, open **Extensions › Apps Script** and paste in `task/apps-script.gs`.
2. **Deploy › New deployment › Web app**, execute as *Me*, access *Anyone*. Copy the `/exec` URL.
3. Paste it into `SHEET_URL` at the top of `task/task.js` and redeploy.
4. Do a `?demo` run and check that rows appear in the `participants` and `trials` tabs.

## Analysing

```bash
uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python pandas numpy scipy statsmodels matplotlib pingouin openpyxl
mkdir -p data/raw          # drop every participant CSV in here (this folder never goes to GitHub, it has emails in it)
.venv/bin/python analysis/analyze.py data/raw
tectonic -X compile report/main.tex
```

Want to try it before real data exists? `.venv/bin/python analysis/simulate.py 24` then
`.venv/bin/python analysis/analyze.py data/sim`.

## Helping out

Contributions are very welcome! Fork the repo or ask to be added as a collaborator, then open a pull request. Some ideas:

- Run the `?demo` on your own phone and laptop and open an issue for anything that feels off
- Recruit participants and share your CSVs privately (never commit them, they contain emails)
- Improve the wording, the visuals, or the analysis plots
- Help write the discussion section of the report once the data is in

Please keep participant data out of the repo, and keep the tone friendly. People are doing us a favour by playing!

## Credits

Path complexity follows the language of geometry by Amalric et al. (2017) and Al Roumi et al. (2021). The inner voice
questions come from the Internal Representations Questionnaire (Roebuck & Lupyan, 2020). Full references are in the report.
