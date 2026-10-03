# Python analysis in Prem

Prem can run Python for the notes in a vault, on your own computer, so an analysis and its results are kept with the experiment they belong to.

## Analysis cells

Write the code in a `python {run}` block in any note and choose **Run** above it, or press ⇧↵ with the cursor in the cell. **Run all Python cells** (⌥⌘↵) starts Python afresh and runs every cell from the top, stopping at the first that fails. The **Analysis** template has a cell to start from.

````markdown
```python {run}
import pandas as pd
df = pd.read_csv("attachments/plate.csv")
df.groupby("sample").od.mean()
```
````

The output is written into the note, straight under the cell, as plain markdown, so it reads in any editor and prints to PDF:

````markdown
<!-- prem:output code=1f2e3d4c5b6a7980 ran=2026-10-02T14:05:31Z by=Cam took=1.2 python=3.12.4 env=9b1e2c3d4f5a inputs=Notebook/2026/attachments/plate.csv@a41c0e12f3b4 -->
```text
sample
S1    0.42
S2    0.90
```
![Figure 1](attachments/analysis-1f2e3d4c-figure-1.png)
![Table: 2 rows × 2 columns](attachments/analysis-1f2e3d4c-table-1.csv)
<!-- /prem:output -->
````

The first line records what produced the output:

| Field | Meaning |
|---|---|
| `code` | A fingerprint of the cell's code. When the code changes, Prem says the output is out of date until you run it again. |
| `ran`, `by`, `took` | When it ran, who ran it, and how many seconds it took. |
| `python`, `env` | The Python version and the vault environment (`-` when there's no `environment.txt`). The environment's full package list is saved as `attachments/environment-<env>.txt`. |
| `inputs` | Every file the code read, with the start of its SHA-256. |
| `ok=no` | The cell raised an error or was stopped; the traceback is in the output. |

**What happens to outputs:**
- Figures and tables are stored as attachments next to the note. Running a cell again replaces its output; the old attachment files are kept, so earlier versions in the note's history still show their figures.
- Because outputs are ordinary text in the note, they're saved in its history and covered by signing.
- A PDF export prints each output with a line saying what produced it.

## Reproducing an analysis

The point of keeping analyses in the notebook is that anyone can check them later. Prem keeps what a rerun needs.

**What Prem saves:**
- **The exact environment.** When a cell runs in the vault's environment, Prem saves that environment's full package list next to the note, as `attachments/environment-<env>.txt`. It lists every package at the version that was installed (`pip freeze`) plus the Python version. The output's `env=` names it, so it can always be found again. The file is plain pip requirements, so `pip install -r environment-<env>.txt` works outside Prem too.
- **What the code read.** Every file a cell reads is recorded with its SHA-256.

**Inputs that change.** If a file an output read changes or disappears afterwards, the cell says so, for example "plate.csv changed since this output". Cells further down are flagged too, since they use what the earlier cells computed.

**Reproduce.** Choose **↻ Reproduce** on a cell, or **Reproduce this note's outputs** from the command palette or the Note menu.
- **What it does:**
  - rebuilds the environment the outputs recorded from its saved package list, even if the vault's `environment.txt` has moved on since;
  - reruns the cells from the top in a fresh Python;
  - compares each output with the one in the note: printed text, warnings, errors, and figures and tables byte for byte.
- **The report says:**
  - which outputs are the same;
  - which parts differ;
  - whether the files the code read have changed;
  - whether the environment was rebuilt exactly.
- **When it can't be rebuilt exactly:** the report says why. For example, a different Python version is installed, or the package list wasn't saved for outputs made before Prem saved them.
- **Nothing changes:** Reproduce never edits the note, so it also works on signed records. To replace an output, run the cell.

Outputs made without an `environment.txt` ran in whatever Python the computer had, so they can only be rerun, not rebuilt. Add an `environment.txt` and pin versions (`pandas==2.2.3`) for analyses you'll need to reproduce.

## Python on your computer

Prem looks for Python in this order:

1. the path in **Settings → Analysis → Python**, if you set one;
2. [uv](https://docs.astral.sh/uv/), if it's installed: the Python it manages;
3. `python3` (or `py -3` on Windows).

**Settings → Analysis** shows what it found. Prem never downloads or installs anything by itself.

## One environment per vault

To make every computer in a lab run analyses the same way, put an `environment.txt` at the top of the vault, listing the packages the analyses use, one per line, in [pip's requirements format](https://pip.pypa.io/en/stable/reference/requirements-file-format/):

```text
numpy==2.1.3
pandas==2.2.3
matplotlib==3.9.2
```

Prem builds an environment from it, with uv when it's installed and with Python's own `venv` and `pip` otherwise. It does this when you choose **Set up environment** in Settings, or before the first cell runs. It rebuilds the environment when `environment.txt` changes.

The environment is kept in Prem's own settings folder (`envs/` next to `settings.json`), never in the vault, so nothing large is synced or committed. Each one gets a short id from its Python version and the exact package versions installed (`pip freeze`), and that id is recorded with every result it produces.

Without an `environment.txt`, cells run in the Python Prem found, with whatever packages it has.

## How cells run

- **Each note gets its own Python process**, so variables carry from one cell to the next, as in Jupyter. Closing a note, switching vaults or quitting Prem ends it.
- **What's shown:** printed output, errors (with the traceback trimmed to your code), the value of a cell's last line, pandas tables, and matplotlib figures (saved as PNG).
- **Which files are recorded:** Prem notes every file a cell reads from the vault, with its SHA-256, so a result says exactly which data it came from.
- **Where code runs:** in the note's folder, so `pd.read_csv("attachments/plate.csv")` works. On a team server, code runs on your computer against a copy of the note's attachments; it never touches the server directly.
- **On a team vault**, the first time you run a note that someone else changed last, Prem asks before running their code on your computer.
- **Limits:**
  - code runs only when you choose Run;
  - a signed note's cells can't be run until it's amended;
  - a cell is stopped after **Settings → Analysis → Stop a cell after** (300 seconds by default);
  - turning off **Run Python in notes** stops all of it.
