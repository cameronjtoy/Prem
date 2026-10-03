# Python analysis in Prem

Prem can run Python for the notes in a vault, on your own computer, so an analysis and its results are kept with the experiment they belong to.

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
- **Limits:**
  - code runs only when you choose Run;
  - a signed note's cells can't be run until it's amended;
  - a cell is stopped after **Settings → Analysis → Stop a cell after** (300 seconds by default);
  - turning off **Run Python in notes** stops all of it.
