# Writing to Prem from Python

The `prem-notebook` package lets analysis code put its results straight into the notebook entry they belong to: figures, tables, files and single values. It works from a script, a Jupyter notebook, or a [Python cell](analysis.md) inside an entry, against a vault folder on your computer or a Prem team server.

```bash
pip install "prem-notebook[pandas]"
```

It needs Python 3.9 or later and nothing else. pandas is used when it's installed (`[pandas]` installs it), and so is matplotlib. The package is imported as `prem`.

## Connecting

```python
import prem

vault = prem.connect("~/Lab vault")                           # a vault folder
vault = prem.connect("https://prem.lab.example", token="…")   # a team server
vault = prem.connect()                                        # see below
```

With no arguments, `connect()` uses the `PREM_VAULT` environment variable (a folder or a server address). If that isn't set, it uses the vault the current folder is inside. That's what makes it work in a Python cell, which runs in the note's folder.

A team server needs your access token, the same one you gave the Prem app. Pass it as `token=` or set `PREM_TOKEN`, and keep it out of notebooks you share.

The server's address must start with `https://`, so the token is never sent unencrypted. The one exception is a server on the same computer (`http://localhost`, `http://127.0.0.1`). `connect(url, token=…, insecure=True)` allows plain `http://` anyway, with a warning. Redirects aren't followed, so the token only ever goes to the address you gave.

## Finding an entry

```python
entry = vault.entry("Ligation of insert into pUC19")      # by title
entry = vault.entry("Notebook/2026/Gel run")              # by path; ".md" is optional
entry = vault.entry("[[Plasmid miniprep]]")               # a link works too

runs = vault.notes(type="run")                            # every note whose frontmatter says type: run
entry.text, entry.fields                                  # its markdown, and its frontmatter as a dict
```

A title has to be unique. If two notes share it, use the path.

## Adding results

```python
entry.attach(fig)                         # a matplotlib figure, as figure.png
entry.attach(fig, name="growth.svg")      # or SVG, PDF or JPEG, by the name's extension
entry.attach(df, name="colonies.csv")     # a pandas DataFrame or Series, as CSV
entry.attach("plate-reader.xlsx")         # any file, up to 100 MB
entry.attach(data, name="trace.bin")      # bytes, with a name
entry.attach(fig, under="Results")        # at the end of the ## Results section instead of the note

entry.record("Colonies", 84)                          # a row in the ## Results table
entry.record("Concentration", 112, unit="ng/µL", note="NanoDrop")
entry.record("OD600", 0.43, replace=False)            # another row, even if OD600 is already there

entry.append("Plates moved to the 4 °C room.", under="Notes")
```

How attachments are stored:
- Files go in the `attachments` folder next to the note, the same place Prem puts files you drop in.
- A file name that's already taken gets a number, so nothing is overwritten.
- Images and CSV files show inline in Prem, and other files show as links.

How `record` works:
- It writes to the table under `## Results`, and creates the section and table if they aren't there.
- A row with the same measurement is updated rather than repeated.
- An existing table keeps its own columns. Unit and Note columns are added only when you give a unit or a note.

## Reading tables

```python
tables = entry.tables()          # {"Results": DataFrame, "Materials": DataFrame, …}, keyed by the heading above each
results = entry.table("Results")
plate = entry.read_file("attachments/plate.csv")   # the bytes of an attachment
```

Columns whose cells are all numbers come back as numbers. Without pandas, each table is a list of dicts.

## History, permissions and signed notes

Every change shows up in the note's history in Prem, like an edit made in the app.

- **Team server:** the change is recorded under your name, and your permissions apply. A folder you can only read raises `prem.ForbiddenError`.
- **Local vault:** Prem records the change as **Changed outside Prem** the next time it sees the note, which is straight away if the app is open. The package doesn't write Prem's history itself, so the history's tamper check stays intact.
- **Signed notes:** they're never changed. Writing to one raises `prem.LockedError`. To change a signed record, open it in Prem and choose **Amend**, which records why.
- **Notes edited at the same moment:** if the note changes between being read and being written, you get `prem.ConflictError` instead of overwriting the other edit. Run the call again.

The other errors are `prem.NotFoundError` and `prem.ExistsError`. All of them are subclasses of `prem.PremError`.

## In a Python cell

Add `prem-notebook` to the vault's `environment.txt` so every computer in the lab has it. Then, in a cell:

```python {run}
import prem
import matplotlib.pyplot as plt

entry = prem.connect().entry("Ligation of insert into pUC19")
fig, ax = plt.subplots()
ax.bar(["Insert", "Empty vector"], [84, 12])
entry.attach(fig, name="colonies.png", under="Results")
entry.record("Colonies with insert", 84)
```

A cell's own figures and tables already go under the cell (see [Python analysis](analysis.md)). The package is for writing to other entries, and for adding results where a reader would look for them.

## Publishing the package (maintainers)

Releases go to PyPI from GitHub, with no token stored anywhere:
1. **Once only:** on pypi.org, under *Your projects → Publishing → Add a pending publisher*, choose GitHub and enter:
   - owner `cameronjtoy`;
   - repository `Prem`;
   - workflow `python-release.yml`;
   - environment `pypi`.
2. **For each release:**
   - set `__version__` in `python/src/prem/__init__.py`;
   - merge;
   - publish a GitHub release tagged `py-v<version>`, for example `py-v0.1.0`.

   The **Python release** workflow checks that the tag matches the version, builds the package and uploads it.
