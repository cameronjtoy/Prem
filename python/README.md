# prem-notebook

Write figures, tables and results to your [Prem](https://github.com/cameronjtoy/Prem) lab notebook from Python: from a script, a Jupyter notebook, or a Python cell inside a Prem entry.

```bash
pip install "prem-notebook[pandas]"
```

```python
import prem

vault = prem.connect("~/Lab vault")                  # a vault folder on this computer
entry = vault.entry("Ligation of insert into pUC19") # by title, or by path

entry.attach(fig)                       # a matplotlib figure, saved as PNG next to the note
entry.attach(df, name="colonies.csv")   # a pandas DataFrame, saved as CSV
entry.attach("plate-reader.xlsx")       # any file, up to 100 MB
entry.record("Colonies", 84)            # a row in the note's Results table
entry.tables()                          # every table in the note, as DataFrames
```

A team server works the same way, with your access token:

```python
vault = prem.connect("https://prem.lab.example", token="prem_…")  # or set PREM_TOKEN
```

- **Team server:** your permissions apply, and each change is recorded in the note's history under your name.
- **Local vault:** Prem records the change in the note's history as an edit made outside Prem.
- **Signed notes:** they're never changed. Writing to one raises `prem.LockedError`; amend it in Prem instead.
- **Python cells:** inside a cell in a Prem entry, `prem.connect()` with no arguments finds the vault the note is in.

The [guide](https://github.com/cameronjtoy/Prem/blob/main/docs/python.md) has more examples. The package has no required dependencies. pandas is used when it's installed, and so is matplotlib.
